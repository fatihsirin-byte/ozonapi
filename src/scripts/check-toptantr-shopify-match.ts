// Geçici kontrol scripti — toptantr'a bağlı (ToptantrListing.status === "success") handle'ların
// Shopify'daki canlı katalogla eşleşip eşleşmediğini kontrol eder. Hiçbir yere yazmaz.
// `npx tsx src/scripts/check-toptantr-shopify-match.ts`
import { prisma } from "../db/prisma";
import { fetchShopifyStockByLocation } from "../shopify/inventory";

async function main() {
  console.log("Shopify'dan canlı katalog çekiliyor (bulk operation, birkaç dakika sürebilir)...");
  const shopifyRows = await fetchShopifyStockByLocation();
  const shopifyHandles = new Set(shopifyRows.map((r) => r.productHandle).filter(Boolean));
  console.log(`Shopify'da ${shopifyHandles.size} farklı handle var.\n`);

  const listings = await prisma.toptantrListing.findMany({
    select: { shopifyHandle: true, status: true, toptantrProductId: true },
  });
  console.log(`VPS DB'de toplam ${listings.length} ToptantrListing kaydı var.`);

  const byStatus = new Map<string, number>();
  for (const l of listings) byStatus.set(l.status, (byStatus.get(l.status) ?? 0) + 1);
  console.log("Durum dağılımı:", Object.fromEntries(byStatus));

  const success = listings.filter((l) => l.status === "success");
  console.log(`\n"success" durumunda ${success.length} kayıt var.\n`);

  let matched = 0;
  const noMatch: typeof success = [];
  for (const l of success) {
    if (shopifyHandles.has(l.shopifyHandle)) matched++;
    else noMatch.push(l);
  }

  console.log("=== SONUÇ (sadece success durumundakiler) ===");
  console.log(`Shopify'da handle'ı bulunan: ${matched}`);
  console.log(`Shopify'da handle'ı bulunmayan: ${noMatch.length}`);
  console.log(`Toplam: ${success.length}`);

  if (noMatch.length > 0) {
    console.log("\n=== Eşleşmeyenler (ilk 50) ===");
    for (const l of noMatch.slice(0, 50)) {
      console.log(`${l.shopifyHandle} | toptantrProductId=${l.toptantrProductId ?? "-"}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
