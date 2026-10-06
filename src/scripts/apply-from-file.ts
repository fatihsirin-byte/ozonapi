// shopify-fetch-to-file.ts'in ürettiği JSON dosyasını okuyup upsertParsedProducts() ile DB'ye
// yazar. DB bağlantısı gerektiren TEK adım burası — Shopify'a hiç gitmez, o yüzden hızlı.
// `npx tsx src/scripts/apply-from-file.ts <input.json>`
import { readFileSync } from "fs";
import { upsertParsedProducts } from "../import/import-products";
import type { ParsedProduct } from "../import/shopify-csv";
import { prisma } from "../db/prisma";

async function main() {
  const inPath = process.argv[2];
  if (!inPath) throw new Error("Kullanım: npx tsx src/scripts/apply-from-file.ts <input.json>");

  const products = JSON.parse(readFileSync(inPath, "utf8")) as ParsedProduct[];
  console.log(`${products.length} ürün dosyadan okundu, DB'ye yazılıyor...`);

  const summary = await upsertParsedProducts(products);
  console.log(`YAZILDI: handle=${summary.handles}, varyant=${summary.variants}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
