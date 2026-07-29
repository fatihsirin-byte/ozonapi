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
      price_strategy_enabled: "UNKNOWN",
    })),
  });
}

export interface OzonPicturesImportResponse {
  result: { product_id: number; images: string[]; images360: string[]; color_image: string };
}

// Sadece görselleri güncellemek için — tüm ürünü yeniden göndermeye gerek kalmıyor.
export function updateImages(params: { productId: number; images: string[] }) {
  return ozonPost<OzonPicturesImportResponse>("/v1/product/pictures/import", {
    product_id: params.productId,
    images: params.images,
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
