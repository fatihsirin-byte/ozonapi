import { ozonPost } from "./client";

// Ozon'un satış/gösterim/dönüşüm analitiği (Seller'ın "Аналитика" bölümündeki veriyle aynı
// kaynak) — mevcut Client-Id/Api-Key ile çalışıyor, reklam (Performance API) için gereken ayrı
// kimlik bilgisine ihtiyaç YOK. NOT: revenue burada Ozon'un kendi para birimi (RUB) cinsinden
// dönüyor — hesabın sözleşme para birimi USD olsa da bu analitik uç noktası her zaman RUB veriyor
// (2026-08-14'te canlıda gerçek sipariş tutarlarıyla karşılaştırılarak doğrulandı).
export const ANALYTICS_METRICS = [
  "revenue",
  "ordered_units",
  "hits_view",
  "hits_tocart",
  "conv_tocart",
  "returns",
  "cancellations",
] as const;

export interface OzonAnalyticsRow {
  dimensions: Array<{ id: string; name: string }>;
  metrics: number[];
}

export interface OzonAnalyticsResponse {
  result: { data: OzonAnalyticsRow[]; totals: number[] };
}

// Gün bazında zaman serisi — trend grafiği + toplam özet kartları için.
export function getAnalyticsByDay(dateFrom: string, dateTo: string) {
  return ozonPost<OzonAnalyticsResponse>("/v1/analytics/data", {
    date_from: dateFrom,
    date_to: dateTo,
    dimension: ["day"],
    metrics: [...ANALYTICS_METRICS],
    limit: 1000,
  });
}

// SKU bazında kırılım — "en çok satan ürünler" tablosu için (sadece ciro/adet, dimension
// name'i Ozon zaten ürün adıyla dolduruyor, local DB join'e gerek yok).
export function getAnalyticsBySku(dateFrom: string, dateTo: string, limit = 1000) {
  return ozonPost<OzonAnalyticsResponse>("/v1/analytics/data", {
    date_from: dateFrom,
    date_to: dateTo,
    dimension: ["sku"],
    metrics: ["revenue", "ordered_units"],
    limit,
  });
}
