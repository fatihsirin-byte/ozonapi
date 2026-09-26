// Shopify stok senkronu — DRY RUN. Hiçbir yere (DB, Ozon, toptantr) yazmaz, sadece rapor basar.
// Amaç: gerçek push mantığı yazılmadan önce (a) SKU eşleşme oranını, (b) kolajen/vitamin
// dışlama listesinin isabetini, (c) mevcut stockQuantity ile Shopify'daki farkın büyüklüğünü
// görmek. `npx tsx src/scripts/shopify-stock-dry-run.ts` ile çalıştırılır.
import { prisma } from "../db/prisma";
import { fetchShopifyStockByLocation } from "../shopify/inventory";
import { isExcludedFromStockSync } from "../shopify/exclusions";

async function main() {
  console.log("Shopify'dan stok çekiliyor (bulk operation, birkaç dakika sürebilir)...");
  const shopifyStock = await fetchShopifyStockByLocation();
  console.log(`Shopify'dan ${shopifyStock.length} SKU'lu stok satırı çekildi.`);

  const localProducts = await prisma.product.findMany({
    where: { shopifyHandle: { not: null } },
    select: { offerId: true, name: true, shopifyHandle: true, stockQuantity: true, ozonProductId: true },
  });

  const shopifyBySku = new Map(shopifyStock.map((row) => [row.sku, row]));

  let matched = 0;
  let excluded = 0;
  let noShopifyMatch = 0;
  let wouldChange = 0;
  const sampleChanges: string[] = [];
  const sampleExcluded: string[] = [];
  const sampleNoMatch: string[] = [];

  for (const p of localProducts) {
    const shopifyRow = shopifyBySku.get(p.offerId);
    if (!shopifyRow) {
      noShopifyMatch += 1;
      if (sampleNoMatch.length < 10) sampleNoMatch.push(`${p.offerId} | ${p.name.slice(0, 50)}`);
      continue;
    }

    if (isExcludedFromStockSync({ sku: p.offerId, handle: p.shopifyHandle ?? "", title: p.name })) {
      excluded += 1;
      if (sampleExcluded.length < 15) sampleExcluded.push(`${p.offerId} | ${p.name.slice(0, 60)}`);
      continue;
    }

    matched += 1;
    if (p.stockQuantity !== shopifyRow.available) {
      wouldChange += 1;
      if (sampleChanges.length < 20) {
        sampleChanges.push(
          `${p.offerId} | mevcut(DB)=${p.stockQuantity ?? "null"} → Shopify=${shopifyRow.available} | ${p.name.slice(0, 40)}`,
        );
      }
    }
  }

  console.log("\n=== ÖZET ===");
  console.log(`Yerel (Shopify-origin) ürün: ${localProducts.length}`);
  console.log(`Senkrona dahil (kolajen/vitamin hariç), Shopify'da eşleşen: ${matched}`);
  console.log(`Dışlanan (kolajen/vitamin heuristiği): ${excluded}`);
  console.log(`Shopify'da SKU eşleşmesi bulunamayan: ${noShopifyMatch}`);
  console.log(`Stok değeri değişecek olan (push edilseydi): ${wouldChange}`);

  console.log("\n--- örnek dışlanan ürünler (kontrol et, yanlış pozitif olabilir) ---");
  sampleExcluded.forEach((s) => console.log(s));

  console.log("\n--- örnek eşleşmeyen SKU'lar ---");
  sampleNoMatch.forEach((s) => console.log(s));

  console.log("\n--- örnek stok değişiklikleri ---");
  sampleChanges.forEach((s) => console.log(s));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Hata:", error);
  process.exit(1);
});
