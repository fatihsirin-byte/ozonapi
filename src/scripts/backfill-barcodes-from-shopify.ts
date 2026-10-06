// Product.barcode'u canlı Shopify varyant barkodundan (GTIN) doldurur ve toptantr'a daha önce
// bağlanmış (legacy processed.json) ürünlerin barkodlarının bizim DB'mizle eşleşip eşleşmediğini
// raporlar. (2026-10-06, kullanıcı talebi: "toptantr için barkodları eşleştir")
//
// Neden gerekli: toptantr eşleştirmesi barcodeOf() ile yapılıyor (barkod, boşsa SKU). Product.barcode
// hiç doldurulmadığı için hep SKU'ya düşüyordu — oysa eski toptantr-shopify-sync ürünleri Shopify
// BARKODUYLA kaydetmiş (ör. SKU 8684306691609, toptantr barkodu 98143193315566). Bu fark, zaten
// bağlı bir üründe "Bağla"ya basılırsa mükerrer ürün oluşturabilir.
//
//   npx tsx src/scripts/backfill-barcodes-from-shopify.ts           # dry-run, hiçbir şey yazmaz
//   npx tsx src/scripts/backfill-barcodes-from-shopify.ts --apply   # sadece barcode'u BOŞ olanlara yazar
//
// Dolu bir barcode'un üstüne ASLA yazmaz — farklıysa "çakışma" olarak raporlar.
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma";
import { fetchShopifyVariantBarcodes } from "../shopify/inventory";

const LEGACY_FILE = path.join(process.cwd(), "private-uploads", "toptantr-legacy", "processed.json");

interface LegacyRecord {
  status?: string;
  barcode?: string;
  title?: string;
  toptantrId?: number;
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("Shopify'dan varyant barkodları çekiliyor (bulk operation)...");
  const shopifyRows = await fetchShopifyVariantBarcodes();
  const bySku = new Map(shopifyRows.map((r) => [r.sku, r]));
  console.log(`${shopifyRows.length} SKU'lu varyant, ${shopifyRows.filter((r) => r.barcode).length} tanesinde barkod var.`);

  const products = await prisma.product.findMany({
    where: { shopifyHandle: { not: null } },
    select: { offerId: true, barcode: true, shopifyHandle: true },
  });

  const toFill: { offerId: string; barcode: string }[] = [];
  const conflicts: string[] = [];
  let noShopifyMatch = 0;
  let shopifyBarcodeEmpty = 0;
  let alreadyOk = 0;

  for (const p of products) {
    const row = bySku.get(p.offerId);
    if (!row) {
      noShopifyMatch++;
      continue;
    }
    if (!row.barcode) {
      shopifyBarcodeEmpty++;
      continue;
    }
    if (!p.barcode) toFill.push({ offerId: p.offerId, barcode: row.barcode });
    else if (p.barcode.trim() === row.barcode) alreadyOk++;
    else conflicts.push(`${p.offerId}: DB=${p.barcode} Shopify=${row.barcode}`);
  }

  console.log(`\nDB'deki Shopify ürünleri: ${products.length}`);
  console.log(`  doldurulacak (DB boş, Shopify'da barkod var): ${toFill.length}`);
  console.log(`  zaten aynı: ${alreadyOk}`);
  console.log(`  çakışma (DB dolu ve farklı — dokunulmaz): ${conflicts.length}`);
  console.log(`  Shopify'da barkodu boş (SKU'ya düşmeye devam eder): ${shopifyBarcodeEmpty}`);
  console.log(`  Shopify'da SKU bulunamadı: ${noShopifyMatch}`);
  conflicts.slice(0, 10).forEach((c) => console.log(`    ! ${c}`));

  // Legacy toptantr kayıtları: toptantr'daki barkod, bu handle'ın varyantlarında var mı?
  const finalBarcode = new Map(products.map((p) => [p.offerId, p.barcode?.trim() || null]));
  for (const f of toFill) finalBarcode.set(f.offerId, f.barcode);

  if (fs.existsSync(LEGACY_FILE)) {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8")) as Record<string, LegacyRecord>;
    const listings = await prisma.toptantrListing.findMany({
      where: { toptantrProductId: { not: null } },
      select: { shopifyHandle: true, toptantrProductId: true },
    });
    const handleByToptantrId = new Map(listings.map((l) => [l.toptantrProductId!, l.shopifyHandle]));
    const variantsByHandle = new Map<string, string[]>();
    for (const p of products) {
      const list = variantsByHandle.get(p.shopifyHandle!) ?? [];
      list.push(p.offerId);
      variantsByHandle.set(p.shopifyHandle!, list);
    }

    let viaBarcode = 0;
    let viaSkuOnly = 0;
    const missing: string[] = [];
    const notLinked: string[] = [];
    for (const rec of Object.values(legacy)) {
      if (rec.status !== "success" || !rec.barcode) continue;
      const handle = handleByToptantrId.get(String(rec.toptantrId));
      if (!handle) {
        notLinked.push(`${rec.toptantrId} ${rec.title}`);
        continue;
      }
      const offerIds = variantsByHandle.get(handle) ?? [];
      if (offerIds.some((id) => finalBarcode.get(id) === rec.barcode)) viaBarcode++;
      else if (offerIds.includes(rec.barcode)) viaSkuOnly++;
      else missing.push(`${handle} (toptantr barkod ${rec.barcode})`);
    }
    console.log(`\nEski toptantr bağlantıları (legacy, status=success):`);
    console.log(`  barkodla eşleşiyor${apply ? "" : " (backfill sonrası)"}: ${viaBarcode}`);
    console.log(`  sadece SKU ile eşleşiyor (Shopify barkodu boş, SKU kullanılmış): ${viaSkuOnly}`);
    console.log(`  EŞLEŞMİYOR (elle bakılmalı): ${missing.length}`);
    missing.forEach((m) => console.log(`    ! ${m}`));
    console.log(`  ToptantrListing'de olmayan (reconcile edilmemiş): ${notLinked.length}`);
    notLinked.forEach((m) => console.log(`    - ${m}`));
  } else {
    console.log(`\n(legacy dosyası yok: ${LEGACY_FILE} — eski bağlantı kontrolü atlandı)`);
  }

  if (!apply) {
    console.log("\nDRY-RUN — hiçbir şey yazılmadı. Uygulamak için --apply.");
  } else {
    let written = 0;
    for (const f of toFill) {
      // where'de barcode: null — script çalışırken biri elle doldurduysa üstüne yazmayalım.
      const res = await prisma.product.updateMany({ where: { offerId: f.offerId, barcode: null }, data: { barcode: f.barcode } });
      written += res.count;
    }
    console.log(`\n${written} ürünün barkodu yazıldı.`);
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
