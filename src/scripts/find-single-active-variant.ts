// ADET bazlı birden fazla varyantı olan (ör. "1 Piece" / "1 Display - 24 Pieces") ve Shopify'da
// (İstanbul deposu, env.shopifyStockLocationId) SADECE BİR varyantı stokta olan ürünleri bulur —
// ör. tekli dolu, Display Box boş. Ağırlık bazlı varyantlar (100g/500g) varsayılan olarak hariç. Hiçbir yere yazmaz,
// sadece konsola özet basar ve CSV üretir. (2026-10-06, kullanıcı talebi)
//
//   npx tsx src/scripts/find-single-active-variant.ts          # sadece ACTIVE Shopify ürünleri
//   npx tsx src/scripts/find-single-active-variant.ts --all    # DRAFT/ARCHIVED dahil
//   npx tsx src/scripts/find-single-active-variant.ts --weight # ağırlık bazlı varyantları da dahil et
//
// Adet: varyant adından extractPackQuantity() (Ozon'un unitsInPack'i için kullanılan aynı regex),
// bulunamazsa DB'deki Product.unitsInPack. Bir ürün, en az iki varyantının adedi FARKLI çıkıyorsa
// "adet bazlı" sayılır.
//
// NOT: SKU'suz varyantlar fetchShopifyStockByLocation'da zaten atlanıyor — bu yüzden varyant
// sayısı "SKU'lu varyant sayısı"dır.
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma";
import { fetchShopifyStockByLocation, type ShopifyStockRow } from "../shopify/inventory";
import { extractPackQuantity } from "../import/pack-quantity";

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const includeAll = process.argv.includes("--all");
  const includeWeight = process.argv.includes("--weight");

  console.log("Shopify'dan stok çekiliyor (bulk operation, birkaç dakika sürebilir)...");
  const rows = await fetchShopifyStockByLocation();
  console.log(`${rows.length} SKU'lu varyant çekildi.`);

  const byHandle = new Map<string, ShopifyStockRow[]>();
  for (const row of rows) {
    if (!row.productHandle) continue;
    if (!includeAll && row.productStatus !== "ACTIVE") continue;
    const list = byHandle.get(row.productHandle) ?? [];
    list.push(row);
    byHandle.set(row.productHandle, list);
  }

  const candidates = [...byHandle.entries()].filter(
    ([, variants]) => variants.length > 1 && variants.filter((v) => v.available > 0).length === 1,
  );

  const unitsBySku = new Map(
    (
      await prisma.product.findMany({
        where: { offerId: { in: candidates.flatMap(([, v]) => v.map((x) => x.sku)) } },
        select: { offerId: true, unitsInPack: true },
      })
    ).map((p) => [p.offerId, p.unitsInPack]),
  );
  const unitsOf = (v: ShopifyStockRow): number | null => extractPackQuantity(v.variantTitle) ?? unitsBySku.get(v.sku) ?? null;
  const isQuantityBased = (variants: ShopifyStockRow[]) =>
    new Set(variants.map(unitsOf).filter((u): u is number => u != null)).size >= 2;

  const hits = includeWeight ? candidates : candidates.filter(([, variants]) => isQuantityBased(variants));

  const handles = hits.map(([handle]) => handle);
  const [localProducts, toptantrListings] = await Promise.all([
    prisma.product.findMany({
      where: { shopifyHandle: { in: handles } },
      select: { offerId: true, shopifyHandle: true, ozonProductId: true, status: true },
    }),
    prisma.toptantrListing.findMany({
      where: { shopifyHandle: { in: handles }, status: "success" },
      select: { shopifyHandle: true },
    }),
  ]);
  // Ozon'a gönderilmiş = status draft değil (ürün listesindeki "Ozon" filtresiyle aynı kural,
  // bkz. app/api/import/products/facets) — ozonProductId her üründe dolmuyor.
  const ozonOfferIds = new Set(localProducts.filter((p) => p.status !== "draft").map((p) => p.offerId));
  const handlesInDb = new Set(localProducts.map((p) => p.shopifyHandle));
  const toptantrHandles = new Set(toptantrListings.map((l) => l.shopifyHandle));

  const header = [
    "handle",
    "urun",
    "shopify_durum",
    "varyant_sayisi",
    "stoklu_varyant",
    "stoklu_adet",
    "stoklu_sku",
    "stok",
    "bos_varyantlar",
    "bizim_db",
    "ozonda_bagli_bos_varyantlar",
    "toptantr_bagli",
  ];
  const lines = [header.join(",")];
  let ozonAffected = 0;

  for (const [handle, variants] of hits) {
    const active = variants.find((v) => v.available > 0)!;
    const empty = variants.filter((v) => v.available <= 0);
    const emptyOnOzon = empty.filter((v) => ozonOfferIds.has(v.sku));
    if (emptyOnOzon.length > 0) ozonAffected++;
    lines.push(
      [
        handle,
        active.productTitle,
        active.productStatus,
        variants.length,
        active.variantTitle,
        unitsOf(active) ?? "",
        active.sku,
        active.available,
        empty.map((v) => `${v.variantTitle} [${unitsOf(v) ?? "?"} adet] (${v.sku})`).join(" | "),
        handlesInDb.has(handle) ? "evet" : "hayir",
        emptyOnOzon.map((v) => v.sku).join(" | "),
        toptantrHandles.has(handle) ? "evet" : "hayir",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const outDir = path.join(process.cwd(), "private-uploads", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `single-active-variant-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(outFile, "﻿" + lines.join("\n"), "utf8");

  const multiVariant = [...byHandle.values()].filter((v) => v.length > 1).length;
  console.log(`\nÇok varyantlı ürün: ${multiVariant}${includeAll ? "" : " (sadece ACTIVE)"}`);
  console.log(`Sadece bir varyantı stokta olan: ${candidates.length}`);
  console.log(`  bunlardan ADET bazlı olan${includeWeight ? " (--weight: hepsi listeleniyor)" : ""}: ${hits.filter(([, v]) => isQuantityBased(v)).length}`);
  console.log(`  bizim DB'de olan: ${hits.filter(([h]) => handlesInDb.has(h)).length}`);
  console.log(`  boş varyantı Ozon'a gönderilmiş olan: ${ozonAffected}`);
  console.log(`  toptantr'a bağlı olan: ${hits.filter(([h]) => toptantrHandles.has(h)).length}`);
  console.log(`\nCSV: ${outFile}`);
  for (const [handle, variants] of hits.slice(0, 10)) {
    const active = variants.find((v) => v.available > 0)!;
    const empty = variants.filter((v) => v.available <= 0).map((v) => `${v.variantTitle} [${unitsOf(v) ?? "?"}]`);
    console.log(`  - ${handle}: "${active.variantTitle}" [${unitsOf(active) ?? "?"} adet] stokta (${active.available}) — boş: ${empty.join(", ")}`);
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
