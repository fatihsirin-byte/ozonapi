// Geçici kontrol scripti — Ozon'a bağlı ürünlerin (ozonProductId dolu) Shopify'daki canlı
// katalogla SKU/handle bazında eşleşip eşleşmediğini kontrol eder. Stok değerine bakmaz.
// Hiçbir yere yazmaz, sadece rapor basar. `npx tsx src/scripts/check-ozon-shopify-match.ts`
import { prisma } from "../db/prisma";
import { fetchShopifyStockByLocation } from "../shopify/inventory";

async function main() {
  console.log("Shopify'dan canlı katalog çekiliyor (bulk operation, birkaç dakika sürebilir)...");
  const shopifyRows = await fetchShopifyStockByLocation();
  console.log(`Shopify'dan ${shopifyRows.length} varyant satırı çekildi.`);

  const shopifyBySku = new Map(shopifyRows.map((r) => [r.sku, r]));
  const shopifyHandles = new Set(shopifyRows.map((r) => r.productHandle).filter(Boolean));

  const ozonProducts = await prisma.product.findMany({
    where: { ozonProductId: { not: null } },
    select: { offerId: true, name: true, shopifyHandle: true, shopifyVariantId: true, ozonProductId: true },
  });
  console.log(`VPS DB'de Ozon'a bağlı ${ozonProducts.length} ürün var.\n`);

  let matchedBySku = 0;
  let matchedByHandleOnly = 0;
  let noMatch = 0;
  const noMatchList: typeof ozonProducts = [];

  for (const p of ozonProducts) {
    const skuCandidates = [p.shopifyVariantId, p.offerId].filter(Boolean) as string[];
    const skuHit = skuCandidates.some((sku) => shopifyBySku.has(sku));
    if (skuHit) {
      matchedBySku++;
      continue;
    }
    const handleHit = p.shopifyHandle ? shopifyHandles.has(p.shopifyHandle) : false;
    if (handleHit) {
      matchedByHandleOnly++;
      continue;
    }
    noMatch++;
    noMatchList.push(p);
  }

  console.log("=== SONUÇ ===");
  console.log(`SKU ile eşleşen: ${matchedBySku}`);
  console.log(`Sadece handle ile eşleşen (SKU farklı/değişmiş): ${matchedByHandleOnly}`);
  console.log(`Hiç eşleşmeyen: ${noMatch}`);
  console.log(`Toplam: ${ozonProducts.length}`);

  if (noMatchList.length > 0) {
    console.log("\n=== Eşleşmeyenler (ilk 50) ===");
    for (const p of noMatchList.slice(0, 50)) {
      console.log(`${p.offerId} | handle=${p.shopifyHandle ?? "-"} | variantId=${p.shopifyVariantId ?? "-"} | ${p.name}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
