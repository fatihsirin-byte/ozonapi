import { shopifyGraphQl } from "./client";
import { env } from "../config/env";

interface BulkOperationNode {
  id: string;
  status: string;
  errorCode: string | null;
  url: string | null;
}

async function startBulkQuery(query: string): Promise<string> {
  const escaped = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const result = await shopifyGraphQl<{
    bulkOperationRunQuery: { bulkOperation: { id: string; status: string } | null; userErrors: { message: string }[] };
  }>(`mutation { bulkOperationRunQuery(query: "${escaped}") { bulkOperation { id status } userErrors { field message } } }`);

  const { bulkOperation, userErrors } = result.bulkOperationRunQuery;
  if (userErrors.length > 0) {
    throw new Error(`Shopify bulk operation başlatılamadı: ${userErrors.map((e) => e.message).join("; ")}`);
  }
  if (!bulkOperation) {
    throw new Error("Shopify bulk operation başlatılamadı: bulkOperation null döndü");
  }
  return bulkOperation.id;
}

// Bulk operation'lar dakikalar sürebiliyor (mağazanın toplam varyant sayısına göre) — sabit
// aralıklarla durumu sorguluyoruz. 5 dakika (60 * 5sn) üst sınır: bu süre yeterli olmazsa
// mağaza/veri boyutu beklenenin çok üstünde demektir, sonsuza kadar beklemek yerine hata verilir.
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60;

async function waitForBulkOperation(): Promise<BulkOperationNode> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const result = await shopifyGraphQl<{ currentBulkOperation: BulkOperationNode | null }>(
      "{ currentBulkOperation { id status errorCode url } }",
    );
    const op = result.currentBulkOperation;
    if (!op) throw new Error("Shopify bulk operation durumu okunamadı (currentBulkOperation null)");
    if (op.status === "COMPLETED") return op;
    if (op.status === "FAILED" || op.status === "CANCELED") {
      throw new Error(`Shopify bulk operation başarısız: ${op.errorCode ?? op.status}`);
    }
  }
  throw new Error("Shopify bulk operation zaman aşımına uğradı (5 dakika)");
}

async function downloadJsonl(url: string): Promise<unknown[]> {
  const axios = (await import("axios")).default;
  const response = await axios.get<string>(url, { responseType: "text" });
  const lines = response.data.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line) => JSON.parse(line));
}

export interface ShopifyStockRow {
  sku: string;
  available: number;
  productHandle: string;
  productTitle: string;
}

// Belirli bir lokasyondaki (varsayılan: env.shopifyStockLocationId, örn. İstanbul deposu) tüm
// varyantların SKU + mevcut ("available") stoğunu çeker. Bulk operation kullanıyoruz çünkü mağazada
// 100 binin üzerinde varyant var (bkz. daha önceki canlı doğrulama, 113.723 SKU) — sayfalı normal
// sorgu (250/sayfa) yüzlerce isteğe, muhtemelen dakikalarca sürmeye yol açardı.
export async function fetchShopifyStockByLocation(locationId?: string): Promise<ShopifyStockRow[]> {
  const location = locationId ?? env.shopifyStockLocationId;
  if (!location) {
    throw new Error("SHOPIFY_STOCK_LOCATION_ID tanımlı değil ve locationId parametresi verilmedi");
  }

  const query = `{
    productVariants {
      edges {
        node {
          sku
          product { handle title }
          inventoryItem {
            inventoryLevel(locationId: "${location}") {
              quantities(names: ["available"]) { quantity }
            }
          }
        }
      }
    }
  }`;

  await startBulkQuery(query);
  const op = await waitForBulkOperation();
  if (!op.url) return []; // objectCount 0 olabilir (örn. lokasyonda hiç envanter yoksa) — url boş döner

  const rows = await downloadJsonl(op.url);
  const stock: ShopifyStockRow[] = [];
  for (const raw of rows) {
    const row = raw as {
      sku?: string;
      product?: { handle?: string; title?: string };
      inventoryItem?: { inventoryLevel?: { quantities?: { quantity?: number }[] } | null };
    };
    if (!row.sku) continue; // SKU'suz varyantlar (bkz. src/import/shopify-csv.ts sahte offerId notu) — eşleştirilemez, atlanır
    const quantity = row.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity ?? 0;
    stock.push({
      sku: row.sku,
      // Negatif "available" (overselling durumu — bkz. 2026-09-26'daki canlı denetimde görülen
      // -1/-2/-9 gibi değerler) Ozon/toptantr'a OLDUĞU GİBİ gönderilemez (negatif stok anlamsız,
      // marketplace'ler muhtemelen reddeder) — 0'a sabitleniyor.
      available: Math.max(0, quantity),
      productHandle: row.product?.handle ?? "",
      productTitle: row.product?.title ?? "",
    });
  }
  return stock;
}
