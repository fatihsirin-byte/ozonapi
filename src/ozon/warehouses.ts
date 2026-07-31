import { computeBillingWeightGrams } from "../pricing/formula";

// Hesap artık ağırlığa göre İKİ ayrı depo kullanıyor (2026-07-31'de eklendi) — bazı ürünlerin
// "bölgenize teslim edilmiyor" sorununun asıl sebebi buymuş: tek depo, farklı ağırlık
// aralıklarındaki teslimat yöntemleriyle uyumsuzdu. /v2/warehouse/list ile doğrulandı.
export const WAREHOUSE_UNDER_500G = 1020005025032000; // "Cekmekoy-500gr altı"
export const WAREHOUSE_OVER_500G = 1020005025268270; // "cekmeköy 501g üstü"

// Stok göndereceğimiz depoyu, kargo faturalama ağırlığına (paketleme payı + hacimsel ağırlık
// dahil — bkz. pricing/formula.ts computeBillingWeightGrams) göre seçer. Eşik 500g: bu ve altı
// "altı" deposuna, üstü "üstü" deposuna gider — depo isimleriyle birebir eşleşiyor.
export function selectWarehouseId(
  weightGrams: number,
  widthCm?: number | null,
  heightCm?: number | null,
  depthCm?: number | null,
): number {
  const billingWeight = computeBillingWeightGrams(weightGrams, widthCm, heightCm, depthCm);
  return billingWeight <= 500 ? WAREHOUSE_UNDER_500G : WAREHOUSE_OVER_500G;
}
