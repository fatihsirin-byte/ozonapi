import { ozonGet, ozonPost } from "./client";

// Ozon'un kendi yürüttüğü indirim/promosyon "aksiyon"ları (ör. "Эластичный бустинг") —
// ücretli reklam (Performance API) DEĞİL, mevcut Client-Id/Api-Key ile çalışan Seller API
// uç noktaları. Fiyatlar (price, action_price vb.) hesabın sözleşme para birimi USD
// cinsinden geliyor (2026-08-14'te canlıda ürün fiyatlarıyla karşılaştırılıp doğrulandı) —
// analytics.ts'teki revenue'nun RUB olmasıyla KARIŞTIRILMASIN.
export interface OzonAction {
  id: number;
  title: string;
  date_start: string;
  date_end: string;
  potential_products_count: number;
  participating_products_count: number;
  is_participating: boolean;
  description?: string;
}

export function listActions() {
  return ozonGet<{ result: OzonAction[] }>("/v1/actions");
}

export interface OzonActionProduct {
  id: number; // Ozon product_id (bizim offerId değil)
  price: number;
  action_price: number;
  max_action_price: number;
  stock: number;
  min_stock: number;
  price_min_elastic?: number;
  price_max_elastic?: number;
}

// Aksiyona henüz katılmamış ama katılabilecek (aday) ürünler.
export function listActionCandidates(actionId: number, limit = 100, offset = 0) {
  return ozonPost<{ result: { products: OzonActionProduct[]; total: number } }>("/v1/actions/candidates", {
    action_id: actionId,
    limit,
    offset,
  });
}

// Aksiyona şu an katılan ürünler.
export function listActionProducts(actionId: number, limit = 100, offset = 0) {
  return ozonPost<{ result: { products: OzonActionProduct[]; total: number } }>("/v1/actions/products", {
    action_id: actionId,
    limit,
    offset,
  });
}

export interface OzonActivateResult {
  product_ids: number[];
  rejected: Array<{ product_id: number; reason: string }>;
}

// Ürünü aksiyona katar — GERÇEK, canlı bir aksiyona ürün ekler (müşteriye görünen fiyat/bustinge
// hemen etki eder). actionPrice, listActionCandidates'ten gelen price_min_elastic/price_max_elastic
// aralığında olmalı. Top-level "products" alanının 1-1000 öğe istediği canlıda doğrulandı
// (2026-08-14); öğe içi alan adları (product_id/action_price) Ozon dokümantasyonuna göre —
// gerçek bir üründe test edilmedi, ilk kullanımda sonucu (rejected[]) kontrol et.
export function activateActionProducts(actionId: number, products: Array<{ productId: number; actionPrice: number }>) {
  return ozonPost<{ result: OzonActivateResult }>("/v1/actions/products/activate", {
    action_id: actionId,
    products: products.map((p) => ({ product_id: p.productId, action_price: p.actionPrice })),
  });
}

// Ürünü aksiyondan çıkarır — product_ids alan adı canlıda doğrulandı (2026-08-14).
export function deactivateActionProducts(actionId: number, productIds: number[]) {
  return ozonPost<{ result: { product_ids: number[] } }>("/v1/actions/products/deactivate", {
    action_id: actionId,
    product_ids: productIds,
  });
}
