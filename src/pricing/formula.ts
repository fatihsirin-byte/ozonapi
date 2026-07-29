// GEÇİCİ marj: satış = (alış + tahmini kargo) × 1.5. Marj yüzdesi kullanıcıdan gelince güncellenecek.
export const TEMP_MARKUP = 1.5;

// ASE & GBS tarifesi (Ozon Direct Flow, Excel'den) — kullanıcı bu taşıyıcıyı esas almamızı istedi.
// ASE&GBS'nin Economy tier'i yok: 500g altı Extra Small, üstü direkt Express fiyatından gidiyor.
export function estimateShippingCostUsd(weightGrams: number): number {
  if (weightGrams <= 500) {
    // ASE & GBS Extra Small Express TR: $0.80 + $0.0055/1g
    return 0.8 + 0.0055 * weightGrams;
  }
  // ASE & GBS Express TR: $3.00 + $0.5/100g
  return 3.0 + 0.5 * (weightGrams / 100);
}

export function computeSalePrice(costPrice: string | number, weightGrams?: number | null): string {
  const cost = Number(costPrice);
  if (!cost || Number.isNaN(cost)) return "";
  const shipping = weightGrams ? estimateShippingCostUsd(weightGrams) : 0;
  return ((cost + shipping) * TEMP_MARKUP).toFixed(2);
}
