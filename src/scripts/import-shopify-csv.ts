import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importShopifyCsvText } from "../import/import-products";

const DEFAULT_FILE = "products_export_1.csv";

async function main() {
  const fileName = process.argv[2] ?? DEFAULT_FILE;
  const filePath = resolve(process.cwd(), fileName);
  const csvText = readFileSync(filePath, "utf-8");

  console.log(`"${fileName}" okunuyor...`);
  const summary = await importShopifyCsvText(csvText);
  console.log(`Tamamlandı: ${summary.handles} ürün (handle), ${summary.variants} varyant içeri aktarıldı (status: draft).`);
}

main().catch((e) => {
  console.error("ERROR", e);
  process.exit(1);
});
