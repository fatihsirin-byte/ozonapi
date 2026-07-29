// GEÇİCİ fiyat formülü: satış = alış × 1.5. Gerçek formül (kargo+komisyon bazlı) sonradan güncellenecek.
export const TEMP_MARKUP = 1.5;

export function computeSalePrice(costPrice: string | number): string {
  const cost = Number(costPrice);
  if (!cost || Number.isNaN(cost)) return "";
  return (cost * TEMP_MARKUP).toFixed(2);
}
