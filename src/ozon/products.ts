import { ozonPost } from "./client";

export interface OzonProductImportItem {
  offer_id: string;
  name: string;
  price: string;
  old_price?: string;
  currency_code?: string;
  category_id: number;
  description_category_id: number;
  type_id: number;
  weight?: number;
  weight_unit?: string;
  width?: number;
  height?: number;
  depth?: number;
  dimension_unit?: string;
  vat?: string;
  images?: string[];
  attributes?: Array<{ id: number; values: Array<{ value: string; dictionary_value_id?: number }> }>;
}

export interface OzonProductImportResponse {
  result: { task_id: number };
}

export interface OzonProductImportInfoResponse {
  result: {
    items: Array<{
      offer_id: string;
      product_id: number;
      status: string;
      errors: Array<{ code: string; state: string; level: string; description: string; field: string }>;
    }>;
    total: number;
  };
}

// Ürün oluşturma/güncelleme. Aynı offer_id ile çağrılırsa mevcut ürünü günceller.
export function importProducts(items: OzonProductImportItem[]) {
  return ozonPost<OzonProductImportResponse>("/v3/product/import", { items });
}

// import sonucu asenkron işlenir, task_id ile sonucu sorgula.
export function getImportStatus(taskId: number) {
  return ozonPost<OzonProductImportInfoResponse>("/v1/product/import/info", { task_id: taskId });
}

export interface OzonProductInfoListResponse {
  items: Array<Record<string, unknown>>;
}

export function getProductInfoList(offerIds: string[]) {
  return ozonPost<OzonProductInfoListResponse>("/v3/product/info/list", { offer_id: offerIds });
}

export interface OzonPriceUpdateResponse {
  result: Array<{ product_id: number; offer_id: string; updated: boolean; errors: Array<{ code: string; message: string }> }>;
}

// Sadece fiyat güncellemek için — tüm ürünü (kategori/attribute) yeniden göndermeye gerek kalmıyor.
export function updatePrices(items: Array<{ offerId: string; price: string; oldPrice?: string }>) {
  return ozonPost<OzonPriceUpdateResponse>("/v1/product/import/prices", {
    prices: items.map((item) => ({
      offer_id: item.offerId,
      price: item.price,
      old_price: item.oldPrice ?? "0",
      currency_code: "USD",
      price_strategy_enabled: "UNKNOWN",
    })),
  });
}

export interface OzonStockUpdateResponse {
  result: Array<{ product_id: number; offer_id: string; updated: boolean; errors: Array<{ code: string; message: string }> }>;
}

// FBS/rFBS satıcılarda stok, depo bazında bildirilir (warehouse_id zorunlu) — hesabın
// tek deposu Çekmeköy (1020005025032000), src/ozon/warehouses.ts'de sabitlendi.
export function updateStocks(items: Array<{ offerId: string; stock: number; warehouseId: number }>) {
  return ozonPost<OzonStockUpdateResponse>("/v2/products/stocks", {
    stocks: items.map((item) => ({
      offer_id: item.offerId,
      stock: item.stock,
      warehouse_id: item.warehouseId,
    })),
  });
}

export interface OzonProductAttributesResponse {
  result: Array<{
    id: number;
    offer_id: string;
    name: string;
    height: number;
    depth: number;
    width: number;
    dimension_unit: string;
    weight: number;
    weight_unit: string;
    description_category_id: number;
    type_id: number;
    images: string[];
    attributes: Array<{ id: number; values: Array<{ dictionary_value_id: number; value: string }> }>;
  }>;
}

// Bir ürünün TÜM attribute/boyut/görsel bilgisini Ozon'dan doğrudan çeker — "bu üründen kopyala" özelliği için.
export function getProductAttributes(offerIds: string[]) {
  return ozonPost<OzonProductAttributesResponse>("/v4/product/info/attributes", {
    filter: { offer_id: offerIds },
    limit: offerIds.length,
  });
}

export interface OzonProductListResponse {
  result: {
    items: Array<{ product_id: number; offer_id: string }>;
    total: number;
    last_id: string;
  };
}

export function listProducts(lastId = "", limit = 100) {
  return ozonPost<OzonProductListResponse>("/v3/product/list", {
    filter: {},
    last_id: lastId,
    limit,
  });
}

export interface OzonArchiveResponse {
  result: boolean;
}

// Ürünü Ozon'da arşivler (yayından kaldırır) — test/hatalı ürünleri temizlerken kullanılır.
export function archiveProducts(productIds: number[]) {
  return ozonPost<OzonArchiveResponse>("/v1/product/archive", { product_id: productIds });
}
