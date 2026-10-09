// Shopify tam katalog importer'ını arka planda çalıştırıp durumunu tutan modül.
// Nginx proxy_read_timeout 300s ama fetch 8-10dk sürebiliyor — bu yüzden buton isteği
// senkron beklemiyor, işi başlatıp hemen dönüyor; UI durumu bu modülden polling ile okuyor.
// pm2 fork_mode (tek instance) olduğu için process-içi state güvenli.
import { fetchShopifyCatalogInStockOnly } from "./products";
import { upsertParsedProducts } from "../import/import-products";
import { syncShopifyStockToDb } from "./stockSync";

export type ShopifyImportJobStatus =
  | { state: "idle" }
  | { state: "running"; startedAt: string }
  | { state: "done"; startedAt: string; finishedAt: string; handles: number; variants: number }
  | { state: "error"; startedAt: string; finishedAt: string; message: string };

let job: ShopifyImportJobStatus = { state: "idle" };

export function getShopifyImportJobStatus(): ShopifyImportJobStatus {
  return job;
}

export function startShopifyImportJob(): { started: boolean; status: ShopifyImportJobStatus } {
  if (job.state === "running") {
    return { started: false, status: job };
  }

  const startedAt = new Date().toISOString();
  job = { state: "running", startedAt };

  void run(startedAt);

  return { started: true, status: job };
}

async function run(startedAt: string) {
  try {
    const products = await fetchShopifyCatalogInStockOnly();
    const summary = await upsertParsedProducts(products);
    // Shopify bulk operation'lar hesap başına tek tek çalışabildiğinden (bkz. products.ts) stok
    // çekimi fetch'ten SONRA, sıralı yapılıyor.
    await syncShopifyStockToDb();
    job = {
      state: "done",
      startedAt,
      finishedAt: new Date().toISOString(),
      handles: summary.handles,
      variants: summary.variants,
    };
  } catch (err) {
    job = {
      state: "error",
      startedAt,
      finishedAt: new Date().toISOString(),
      message: err instanceof Error ? err.message : "Bilinmeyen hata",
    };
  }
}
