// Shopify'dan canlı tam katalog importer'ı. Sadece İstanbul deposunda EN AZ BİR varyantı
// stoklu olan ürünleri (o ürünün TÜM varyantlarıyla) çeker ve mevcut upsertParsedProducts()
// ile Product tablosuna yazar (CSV importer'ın kullandığı AYNI fonksiyon — Ozon/toptantr
// bağlantılarına asla dokunmaz, sadece Shopify alanlarını günceller).
//
// Varsayılan: dry-run (yazmaz). --apply ile gerçekten DB'ye yazar.
// `npx tsx src/scripts/shopify-import-run.ts`
// `npx tsx src/scripts/shopify-import-run.ts --apply`
import { fetchShopifyCatalogInStockOnly } from "../shopify/products";
import { upsertParsedProducts } from "../import/import-products";
import { prisma } from "../db/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log("Shopify'dan tam katalog + İstanbul stoğu çekiliyor (bulk operation, birkaç dakika sürebilir)...");
  const products = await fetchShopifyCatalogInStockOnly();
  const variantCount = products.reduce((sum, p) => sum + p.variants.length, 0);

  console.log(`Çekilen ürün (handle) sayısı: ${products.length}, varyant sayısı: ${variantCount}`);
  console.log(apply ? "APPLY modu — DB'ye gerçekten yazılacak." : "DRY-RUN modu — hiçbir şey yazılmayacak (--apply ile çalıştırın).");

  if (!apply) {
    await prisma.$disconnect();
    return;
  }

  const summary = await upsertParsedProducts(products);
  console.log("\n=== YAZILDI ===");
  console.log(`Handle: ${summary.handles}, Varyant (Product satırı): ${summary.variants}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
