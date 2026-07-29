// GEÇİCİ fiyat formülü: satış = alış × 1.5. Gerçek formül (kargo+komisyon bazlı) sonradan güncellenecek.
export const TEMP_MARKUP = 1.5;

export function computeSalePrice(costPrice: string | number): string {
  const cost = Number(costPrice);
  if (!cost || Number.isNaN(cost)) return "";
  return (cost * TEMP_MARKUP).toFixed(2);
}

// Ozon'un resmi Türkiye "Direct Flow" tarife tablosundan (Excel, Ozon BD manager önerisi) en
// ucuz taşıyıcı satırları — sadece BİLGİLENDİRME amaçlı tahmini kargo maliyeti, henüz satış
// fiyatı formülüne dahil edilmiyor (gerçek formül kullanıcıdan bekleniyor).
export function estimateShippingCostUsd(weightGrams: number): number {
  if (weightGrams <= 500) {
    // TT Economy Extra Small: $0.69 + $0.004/1g
    return 0.69 + 0.004 * weightGrams;
  }
  // TT/SPEGAT Economy: $2.60 + $0.2/100g
  return 2.6 + 0.2 * (weightGrams / 100);
}
