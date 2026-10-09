// Shopify stok senkronu → Ozon + toptantr. (2026-09-29, kullanıcı kararı)
//
// Mimari kasıtlı olarak iki ayrı davranışa bölünmüş:
//  1) GERÇEK miktarı gönderme — env.ozonStockSyncEnabled / env.toptantrStockSyncEnabled ile
//     kapalı tutuluyor (varsayılan false). Bu açılana kadar sistem hiçbir marketplace'e stok
//     sayısı PUSH etmez.
//  2) "Shopify'da tükendiyse marketplace'te de kapat" — bu istisna env anahtarından BAĞIMSIZ,
//     her zaman çalışır (kullanıcı talebi: overselling riski, opsiyonel olmamalı).
//
// toptantr per-VARYANT değil per-HANDLE bağlanıyor (bkz. src/toptantr/quantity.ts) — o yüzden
// "tükendi" kararı da handle seviyesinde veriliyor: bir handle'ın Shopify'daki TÜM varyantları
// 0'a düşmüşse o toptantr ürününün tüm kombinasyonları kapatılır. Kısmi tükenme (bazı varyant
// 0, bazısı değil) şimdilik toptantr'a yansıtılmıyor — toptantr'ın findProductByBarcode yanıtı
// kombinasyon başına barkod döndürmediği için Shopify varyantı ↔ toptantr kombinasyonu birebir
// eşleşmesi güvenilir kurulamıyor (bkz. ToptantrFoundCombination — sadece id + attributes var).
import { prisma } from "../db/prisma";
import { fetchShopifyStockByLocation, type ShopifyStockRow } from "./inventory";
import { env } from "../config/env";
import { updateStocks } from "../ozon/products";
import { selectWarehouseId } from "../ozon/warehouses";
import { findProductByBarcode, updateCombinations } from "../toptantr/client";
import { barcodeOf } from "../toptantr/quantity";

export interface StockSyncReport {
  dryRun: boolean;
  ozonSyncEnabled: boolean;
  toptantrSyncEnabled: boolean;
  shopifySkuCount: number;
  ozon: { closed: number; updated: number; skippedDisabled: number; errors: { offerId: string; error: string }[] };
  toptantr: { closed: number; updated: number; skippedDisabled: number; skippedNoBarcode: number; errors: { handle: string; error: string }[] };
}

// Shopify'daki güncel stoğu Product.shopifyStock'a yazar (Ürünler listesindeki stok kolonu/filtresi
// için). Marketplace'lere HİÇBİR ŞEY göndermez. Aynı stok değerine sahip SKU'lar tek updateMany'de
// toplanıyor (binlerce tekil UPDATE yerine).
export async function syncShopifyStockToDb(prefetched?: ShopifyStockRow[]): Promise<{ shopifySkus: number; updated: number }> {
  const rows = prefetched ?? (await fetchShopifyStockByLocation());
  const skuByStock = new Map<number, string[]>();
  for (const r of rows) {
    const list = skuByStock.get(r.available);
    if (list) list.push(r.sku);
    else skuByStock.set(r.available, [r.sku]);
  }

  const syncedAt = new Date();
  const CHUNK = 1000;
  let updated = 0;
  for (const [stock, skus] of skuByStock) {
    for (let i = 0; i < skus.length; i += CHUNK) {
      const result = await prisma.product.updateMany({
        where: { OR: [{ shopifyVariantId: { in: skus.slice(i, i + CHUNK) } }, { offerId: { in: skus.slice(i, i + CHUNK) } }] },
        data: { shopifyStock: stock, shopifyStockSyncedAt: syncedAt },
      });
      updated += result.count;
    }
  }
  return { shopifySkus: rows.length, updated };
}

function emptyReport(dryRun: boolean): StockSyncReport {
  return {
    dryRun,
    ozonSyncEnabled: env.ozonStockSyncEnabled,
    toptantrSyncEnabled: env.toptantrStockSyncEnabled,
    shopifySkuCount: 0,
    ozon: { closed: 0, updated: 0, skippedDisabled: 0, errors: [] },
    toptantr: { closed: 0, updated: 0, skippedDisabled: 0, skippedNoBarcode: 0, errors: [] },
  };
}

// dryRun=true (varsayılan): hiçbir API çağrısı yapmaz, sadece "ne yapardım" raporu döner.
// dryRun=false: gerçek çağrıları yapar — ama yine de sadece yukarıdaki iki kurala göre (env
// açıksa gerçek miktar, kapalıysa sadece 0'a düşenleri kapatma).
export async function runStockSync(dryRun = true, prefetched?: ShopifyStockRow[]): Promise<StockSyncReport> {
  const report = emptyReport(dryRun);

  const shopifyRows = prefetched ?? (await fetchShopifyStockByLocation());
  report.shopifySkuCount = shopifyRows.length;
  const shopifyBySku = new Map(shopifyRows.map((r) => [r.sku, r.available]));

  // --- Ozon: per-varyant (offerId = SKU) ---
  const ozonProducts = await prisma.product.findMany({
    where: { ozonProductId: { not: null } },
    select: { offerId: true, shopifyVariantId: true, weightGrams: true, widthCm: true, heightCm: true, depthCm: true, stockQuantity: true },
  });

  const ozonUpdates: { offerId: string; stock: number; warehouseId: number }[] = [];
  for (const p of ozonProducts) {
    const sku = p.shopifyVariantId ?? p.offerId;
    const available = shopifyBySku.get(sku);
    if (available === undefined) continue; // Shopify'da yok (Ozon-orijinli ürün) — dokunulmaz

    const shouldClose = available === 0 && (p.stockQuantity ?? 0) !== 0;
    const shouldSyncQuantity = env.ozonStockSyncEnabled && available !== (p.stockQuantity ?? -1);

    if (!shouldClose && !shouldSyncQuantity) continue;
    if (!shouldClose && !env.ozonStockSyncEnabled) {
      report.ozon.skippedDisabled++;
      continue;
    }

    const targetStock = shouldClose ? 0 : available;
    ozonUpdates.push({
      offerId: p.offerId,
      stock: targetStock,
      warehouseId: selectWarehouseId(p.weightGrams ?? 100, p.widthCm, p.heightCm, p.depthCm),
    });
  }

  if (!dryRun) {
    const OZON_BATCH_SIZE = 100;
    for (let i = 0; i < ozonUpdates.length; i += OZON_BATCH_SIZE) {
      const batch = ozonUpdates.slice(i, i + OZON_BATCH_SIZE);
      const { result } = await updateStocks(batch);
      for (const entry of result) {
        const targeted = batch.find((b) => b.offerId === entry.offer_id);
        if (!entry.updated) {
          report.ozon.errors.push({ offerId: entry.offer_id, error: entry.errors.map((e) => e.message).join("; ") });
          continue;
        }
        if (targeted?.stock === 0) report.ozon.closed++;
        else report.ozon.updated++;
        await prisma.product.update({ where: { offerId: entry.offer_id }, data: { stockQuantity: targeted?.stock ?? 0 } });
      }
    }
  } else {
    for (const u of ozonUpdates) {
      if (u.stock === 0) report.ozon.closed++;
      else report.ozon.updated++;
    }
  }

  // --- toptantr: per-HANDLE (bkz. dosya başı notu) ---
  const toptantrListings = await prisma.toptantrListing.findMany({
    where: { status: "success" },
    select: { shopifyHandle: true, toptantrBarcode: true, manualTiers: true },
  });

  for (const listing of toptantrListings) {
    // Elle kademe girilmiş handle'ların stoğu elle yönetiliyor (Shopify'da stok 0 görünse bile) —
    // otomatik kapatma bunlara dokunmaz.
    if (Array.isArray(listing.manualTiers) && listing.manualTiers.length > 0) continue;
    const variants = await prisma.product.findMany({
      where: { shopifyHandle: listing.shopifyHandle },
      select: { offerId: true, shopifyVariantId: true, barcode: true },
    });
    if (variants.length === 0) continue;

    const availabilities = variants.map((v) => shopifyBySku.get(v.shopifyVariantId ?? v.offerId));
    if (availabilities.every((a) => a === undefined)) continue; // Shopify'da hiç veri yok — dokunulmaz

    const allZero = availabilities.every((a) => (a ?? 0) === 0);
    if (!allZero) {
      // Kısmi/karışık durum: gerçek miktar senkronu env ile açık olsa bile toptantr'da güvenilir
      // varyant eşleşmesi yapılamadığından (bkz. dosya başı notu) burada hiçbir şey yapılmıyor.
      report.toptantr.skippedDisabled++;
      continue;
    }

    const barcode = listing.toptantrBarcode ?? barcodeOf(variants[0]);
    if (!barcode) {
      report.toptantr.skippedNoBarcode++;
      continue;
    }

    if (dryRun) {
      report.toptantr.closed++;
      continue;
    }

    try {
      const found = await findProductByBarcode(barcode);
      const combinations = found?.productAttributeCombinations ?? [];
      if (combinations.length === 0) {
        report.toptantr.errors.push({ handle: listing.shopifyHandle, error: "toptantr'da barkoda karşılık gelen kombinasyon bulunamadı" });
        continue;
      }
      // Kapatırken fiyatı SIFIRLAMIYORUZ — sadece quantity=0 (mevcut fiyat/taxCategory korunur,
      // toptantr'ın kendi yanıtında yoksa env varsayılanına düşülür).
      await updateCombinations(
        combinations.map((c) => ({
          id: c.id,
          quantity: 0,
          taxCategory: c.taxCategory ?? env.toptantrDefaultTaxCategory,
          sellingPrice: c.sellingPrice ?? 0,
        })),
      );
      report.toptantr.closed++;
    } catch (err) {
      report.toptantr.errors.push({ handle: listing.shopifyHandle, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return report;
}

// Zamanlanmış iş (bkz. sync-orders-cron.ts): Shopify stoğunu BİR kez çeker, DB'ye (Ürünler listesi
// stok kolonu) yazar, ardından stoğu biten ürünleri Ozon/toptantr'da kapatır. Gerçek miktar push'u
// hâlâ env bayraklarına bağlı (runStockSync içinde).
export async function runScheduledStockSync(): Promise<{ db: { shopifySkus: number; updated: number }; report: StockSyncReport }> {
  const rows = await fetchShopifyStockByLocation();
  const db = await syncShopifyStockToDb(rows);
  const report = await runStockSync(false, rows);
  return { db, report };
}
