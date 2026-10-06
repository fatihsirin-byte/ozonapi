// Shopify'dan tam katalogu (sadece stoklu ürünler) çekip yerel bir JSON dosyasına kaydeder.
// DB'ye hiç bağlanmaz — amaç, DB yazma adımını Shopify çekiminden AYIRMAK (tünel/DB bağlantısı
// uzun Shopify bulk operation'ı beklerken kopabiliyor, bu script sadece çekip dosyaya yazar).
// `npx tsx src/scripts/shopify-fetch-to-file.ts <output.json>`
import { writeFileSync } from "fs";
import { fetchShopifyCatalogInStockOnly } from "../shopify/products";

async function main() {
  const outPath = process.argv[2];
  if (!outPath) throw new Error("Kullanım: npx tsx src/scripts/shopify-fetch-to-file.ts <output.json>");

  console.log("Shopify'dan tam katalog + İstanbul stoğu çekiliyor (bulk operation, birkaç dakika sürebilir)...");
  const products = await fetchShopifyCatalogInStockOnly();
  const variantCount = products.reduce((sum, p) => sum + p.variants.length, 0);
  writeFileSync(outPath, JSON.stringify(products));
  console.log(`Yazıldı: ${outPath} — ${products.length} ürün, ${variantCount} varyant.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
