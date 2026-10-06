// Shopify'dan canlı tam katalog importer'ı — DRY RUN. Hiçbir yere (DB) yazmaz, sadece rapor
// basar. Sadece İstanbul deposunda stoğu > 0 olan ürün/varyantları getirir (bkz. src/shopify/products.ts).
// `npx tsx src/scripts/shopify-import-dry-run.ts`
import { fetchShopifyCatalogInStockOnly } from "../shopify/products";

async function main() {
  console.log("Shopify'dan tam katalog + İstanbul stoğu çekiliyor (bulk operation, birkaç dakika sürebilir)...");
  const products = await fetchShopifyCatalogInStockOnly();

  const variantCount = products.reduce((sum, p) => sum + p.variants.length, 0);
  const missingBarcode = products.reduce((sum, p) => sum + p.variants.filter((v) => !v.barcode).length, 0);
  const missingCost = products.reduce((sum, p) => sum + p.variants.filter((v) => !v.costPrice).length, 0);

  console.log("=== SONUÇ (sadece stoklu ürün/varyant) ===");
  console.log(`Ürün (handle) sayısı: ${products.length}`);
  console.log(`Varyant sayısı: ${variantCount}`);
  console.log(`Barkodsuz varyant: ${missingBarcode}`);
  console.log(`Maliyetsiz (costPrice) varyant: ${missingCost}`);

  console.log("\n=== İlk 3 ürün örneği ===");
  for (const p of products.slice(0, 3)) {
    console.log(JSON.stringify(p, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
