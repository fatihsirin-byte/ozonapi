// Shopify → Ozon/toptantr stok senkronu, DRY RUN. Hiçbir yere yazmaz, sadece rapor basar.
// `npx tsx src/scripts/stock-sync-dry-run.ts`
import { runStockSync } from "../shopify/stockSync";

async function main() {
  const report = await runStockSync(true);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
