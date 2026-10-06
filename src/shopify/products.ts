// Shopify'dan CANLI tam ürün verisi çeker (başlık, vendor, görseller, açıklama, metafield,
// varyant SKU/barkod/fiyat/ağırlık) — CSV importer'ın (src/import/shopify-csv.ts) ürettiği
// AYNI ParsedProduct[] şeklini üretir, sadece kaynak CSV dosyası değil canlı GraphQL API.
// (2026-09-29, kullanıcı kararı: "shopify dan implement edici yazmamız lazım")
//
// ÖNEMLİ — sadece STOKLU varyantlar döner (kullanıcı talebi: "stoğu aktf olanları çekciez
// sadece"). Tükenmiş (0 stok) bir varyant ürüne hiç eklenmiyor; bir ürünün TÜM varyantları
// tükenmişse ürünün kendisi de sonuca dahil edilmiyor (DB'ye boş/satılamaz bir ürün girmesin).
import { shopifyGraphQl } from "./client";
import { fetchShopifyStockByLocation } from "./inventory";
import { METAFIELD_COLUMNS, type ParsedProduct, type ParsedVariant } from "../import/shopify-csv";

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

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // tam katalog ürün+varyant+görsel+metafield indirmesi stok-only sorgudan daha uzun sürebilir — 10 dk üst sınır

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
  throw new Error("Shopify bulk operation zaman aşımına uğradı (10 dakika)");
}

async function downloadJsonl(url: string): Promise<unknown[]> {
  const axios = (await import("axios")).default;
  const response = await axios.get<string>(url, { responseType: "text" });
  const lines = response.data.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line) => JSON.parse(line));
}

// METAFIELD_COLUMNS'daki CSV başlığından ("... (product.metafields.NS.KEY)") namespace.key
// çıkarıp kısa ada eşleyen ters tablo — GraphQL metafields(first) satırlarını CSV ile aynı
// kısa anahtarlara ("brand", "turkishTitle" vb.) dönüştürmek için.
const METAFIELD_NS_KEY_TO_SHORT: Record<string, string> = {};
for (const [short, column] of Object.entries(METAFIELD_COLUMNS)) {
  const m = column.match(/product\.metafields\.([a-z0-9_]+)\.([a-z0-9_-]+)/i);
  if (m) METAFIELD_NS_KEY_TO_SHORT[`${m[1]}.${m[2]}`] = short;
}

interface RawLine {
  id: string;
  __parentId?: string;
  handle?: string;
  title?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  descriptionHtml?: string;
  url?: string; // image
  namespace?: string; // metafield
  key?: string; // metafield
  value?: string; // metafield
  sku?: string | null; // variant
  barcode?: string | null; // variant
  price?: string; // variant
  selectedOptions?: { name: string; value: string }[]; // variant
  image?: { url: string } | null; // variant
  inventoryItem?: { unitCost?: { amount: string } | null; measurement?: { weight?: { value: number; unit: string } | null } | null };
}

function gramsFromWeight(weight?: { value: number; unit: string } | null): number {
  if (!weight) return 0;
  switch (weight.unit) {
    case "GRAMS":
      return Math.round(weight.value);
    case "KILOGRAMS":
      return Math.round(weight.value * 1000);
    case "POUNDS":
      return Math.round(weight.value * 453.592);
    case "OUNCES":
      return Math.round(weight.value * 28.3495);
    default:
      return Math.round(weight.value);
  }
}

interface ProductAccumulator {
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  descriptionHtml: string;
  images: string[];
  metafields: Record<string, string>;
  variants: ParsedVariant[];
}

// Tam katalog ürün verisini (stok HARİÇ — bkz. dosya başı notu, stok ayrı sorguyla birleştiriliyor)
// bulk operation ile çeker. Tek bir kök `products` sorgusu ve iç içe connection'lar (images,
// metafields, variants) kullanıyoruz — Shopify bulk operation bunları otomatik olarak ayrı
// JSONL satırlarına düzleştirip `__parentId` ile üst ürüne bağlıyor.
export async function fetchShopifyCatalog(): Promise<ParsedProduct[]> {
  const query = `{
    products {
      edges {
        node {
          id
          handle
          title
          vendor
          productType
          tags
          descriptionHtml
          images(first: 250) { edges { node { url } } }
          metafields(first: 50) { edges { node { namespace key value } } }
          variants(first: 250) {
            edges {
              node {
                id
                sku
                barcode
                price
                selectedOptions { name value }
                image { url }
                inventoryItem {
                  unitCost { amount }
                  measurement { weight { value unit } }
                }
              }
            }
          }
        }
      }
    }
  }`;

  await startBulkQuery(query);
  const op = await waitForBulkOperation();
  if (!op.url) return [];

  const rawLines = (await downloadJsonl(op.url)) as RawLine[];

  const productsById = new Map<string, ProductAccumulator>();
  for (const line of rawLines) {
    if (!line.__parentId) {
      // Kök ürün satırı — handle olmadan devam edemeyiz (Shopify'da handle zorunlu ama yine de savunma)
      if (!line.handle) continue;
      productsById.set(line.id, {
        handle: line.handle,
        title: line.title ?? line.handle,
        vendor: line.vendor ?? "",
        productType: line.productType ?? "",
        tags: line.tags ?? [],
        descriptionHtml: line.descriptionHtml ?? "",
        images: [],
        metafields: {},
        variants: [],
      });
      continue;
    }

    const parent = productsById.get(line.__parentId);
    if (!parent) continue; // bulk operation garantisi: parent her zaman child'lardan önce gelir

    if (line.sku !== undefined) {
      // Varyant satırı
      const optionValues = (line.selectedOptions ?? []).map((o) => o.value).filter(Boolean);
      const sku = line.sku?.trim();
      parent.variants.push({
        sku: sku || `${parent.handle}-v${parent.variants.length + 1}`,
        barcode: line.barcode?.trim() || null,
        grams: gramsFromWeight(line.inventoryItem?.measurement?.weight),
        price: line.price ?? null,
        costPrice: line.inventoryItem?.unitCost?.amount ?? line.price ?? null,
        optionValues,
        image: line.image?.url ?? null,
        position: parent.variants.length,
      });
    } else if (line.namespace !== undefined) {
      // Metafield satırı
      const shortKey = METAFIELD_NS_KEY_TO_SHORT[`${line.namespace}.${line.key}`];
      if (shortKey && line.value) parent.metafields[shortKey] = line.value;
    } else if (line.url !== undefined) {
      // Görsel satırı
      parent.images.push(line.url);
    }
  }

  return [...productsById.values()].map((p) => ({
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    vendor: p.vendor,
    productType: p.productType,
    tags: p.tags,
    images: p.images,
    metafields: p.metafields,
    variants: p.variants,
  }));
}

// Tam katalog + İstanbul deposu stoğunu birleştirip SADECE en az bir varyantı stoklu (>0) olan
// ÜRÜNLERİ döndürür (kullanıcı talebi, 2026-09-29: "stoğu aktf olanları çekciez sadece").
// Bir ürünün TÜM varyantları tükenmişse ürün sonuca hiç dahil edilmez — ama en az bir varyant
// stokluysa o ürünün TÜM varyantları (0 stoklu olanlar dahil) döner: çoğu ürün "bir varyant
// stoklu, diğerleri değil" şeklinde ve varyant setinin (Adet/Paket/Koli kademeleri) eksiksiz
// gelmesi gerekiyor (kullanıcı talebi, 2026-09-29: "hepsini çek").
export async function fetchShopifyCatalogInStockOnly(locationId?: string): Promise<ParsedProduct[]> {
  // Shopify hesap başına aynı anda TEK bir bulk operation çalıştırabiliyor — paralel (Promise.all)
  // başlatılan iki bulk query birbirini geçersiz kılıyor/karışıyor, o yüzden burada bilerek SIRALI.
  const catalog = await fetchShopifyCatalog();
  const stockRows = await fetchShopifyStockByLocation(locationId);
  const availableBySku = new Map(stockRows.map((r) => [r.sku, r.available]));

  return catalog.filter((product) => product.variants.some((v) => (availableBySku.get(v.sku) ?? 0) > 0));
}
