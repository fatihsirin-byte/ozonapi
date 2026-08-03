// Fiyat formülü (2026-07-29, kullanıcıdan alınan gerçek parametreler).

// Ürün özelliklerindeki ağırlık paketleme/kutu ağırlığını içermiyor — kargo hesabında
// gerçek gönderi ağırlığını hafife almamak için %35 pay + 10g sabit paketleme ağırlığı ekliyoruz
// (2026-08-03 itibarıyla %20'den %35 + 10g'a yükseltildi, kullanıcı talebiyle).
const PACKAGING_WEIGHT_BUFFER = 1.35;
const PACKAGING_WEIGHT_EXTRA_GRAMS = 10;

// ASE'nin PDF tarifesinde: kenarların toplamı ≤90cm ise fiziksel ağırlık, >90cm ise fiziksel
// veya hacimsel ağırlıktan HANGİSİ BÜYÜKSE o kullanılır. Hacimsel ağırlık formülü: en×boy×
// yükseklik (cm) ÷ 5000 = kg. Fiziksel ağırlığa önce %35 paketleme payı + 10g ekleniyor.
export function computeBillingWeightGrams(
  weightGrams: number,
  widthCm?: number | null,
  heightCm?: number | null,
  depthCm?: number | null,
): number {
  const bufferedWeight = weightGrams * PACKAGING_WEIGHT_BUFFER + PACKAGING_WEIGHT_EXTRA_GRAMS;
  if (!widthCm || !heightCm || !depthCm) return bufferedWeight;

  const sumOfSides = widthCm + heightCm + depthCm;
  if (sumOfSides <= 90) return bufferedWeight;

  const volumetricGrams = ((widthCm * heightCm * depthCm) / 5000) * 1000;
  return Math.max(bufferedWeight, volumetricGrams);
}

// ASE & GBS tarifesi — ASE'nin kendi PDF tarife tablolarından (gram bazlı lookup) birebir
// türetilmiş doğrusal formüller. Economy tier'i yok: 500g altı Extra Small, üstü standart
// Express (DG/batarya hattı çok daha pahalı olduğu için kullanılmıyor — kullanıcı talebi).
export function estimateShippingCostUsd(weightGrams: number): number {
  if (weightGrams <= 500) {
    // ASE & GBS Extra Small Express TR (PDF ile doğrulandı): $0.80 + $0.0055/1g
    return 0.8 + 0.0055 * weightGrams;
  }
  // ASE & GBS Express TR (standart, batarya/sıvı hariç): $3.00 + $0.5/100g, maks 25kg
  return 3.0 + 0.5 * (weightGrams / 100);
}

const MARGIN_RATE = 0.4; // alış fiyatı üzerine %40 marj
// Alış fiyatı $1'ın altındaki ürünlerde %40 marj mutlak olarak çok küçük kalıyor (örn. $0.29
// alışta ~$0.10 kâr) — bir iade/hasar/ekstra kesinti tek işlemde bunu sıfırlıyor. Bu yüzden
// düşük alış fiyatlı ürünlerde marjı %65'e çıkarıyoruz (2026-08-03, kullanıcı talebi).
const LOW_COST_MARGIN_RATE = 0.65;
const LOW_COST_THRESHOLD_USD = 1;

function marginRateForCost(cost: number): number {
  return cost < LOW_COST_THRESHOLD_USD ? LOW_COST_MARGIN_RATE : MARGIN_RATE;
}
const COMMISSION_RATE = 0.05; // Ozon komisyonu
const LOGISTICS_SERVICE_RATE = 0.02; // lojistik hizmet bedeli
const LOGISTICS_SERVICE_CAP_RUB = 200; // lojistik hizmet bedeli tavanı
const BANK_FEE_RATE = 0.019; // banka işlem ücreti

// Gerçek kur ~79.47 RUB (2026-07-29). Güvenli tarafta kalmak için kuru biraz düşük tutuyoruz:
// RUB güçlenirse (kur düşerse) 200 RUB'un dolar karşılığı büyür — gideri hafife almamak için
// gerçek kurun altında bir değer kullanmak marjı korur. TODO: canlı kur ile güncellenebilir.
const USD_TO_RUB_RATE = 75;

// AB'nin 200€ gümrüksüz sınırına göre — EUR/USD dalgalanmasına karşı ~%10 güvenlik tamponuyla
// $220. Fiyat bu sınırla $230 arasına düşerse müşteri gümrük ödemesin diye $219.99'a çekiyoruz;
// çok daha yüksekse indirim anlamsız (kazancı eritir), dokunmuyoruz.
const CUSTOMS_SAFE_PRICE_USD = 220;
const CUSTOMS_DISCOUNT_BAND_UPPER_USD = 230;
const CUSTOMS_ROUNDED_PRICE_USD = 219.99;

function totalFeeRate(price: number): number {
  const logisticsFeeUsd = Math.min(price * LOGISTICS_SERVICE_RATE, LOGISTICS_SERVICE_CAP_RUB / USD_TO_RUB_RATE);
  return COMMISSION_RATE + logisticsFeeUsd / price + BANK_FEE_RATE;
}

export function computeSalePrice(
  costPrice: string | number,
  weightGrams?: number | null,
  dimsCm?: { widthCm?: number | null; heightCm?: number | null; depthCm?: number | null },
): string {
  const cost = Number(costPrice);
  if (!cost || Number.isNaN(cost)) return "";

  const billingWeight = weightGrams
    ? computeBillingWeightGrams(weightGrams, dimsCm?.widthCm, dimsCm?.heightCm, dimsCm?.depthCm)
    : 0;
  const shipping = billingWeight ? estimateShippingCostUsd(billingWeight) : 0;
  const target = cost * (1 + marginRateForCost(cost)) + shipping;

  // Lojistik hizmet bedeli tavanlı olduğu için oran fiyata bağlı — bir kere kabaca hesaplayıp,
  // bulunan fiyatla oranı yeniden hesaplayarak (tavan dahil) düzeltiyoruz.
  let price = target / (1 - (COMMISSION_RATE + LOGISTICS_SERVICE_RATE + BANK_FEE_RATE));
  price = target / (1 - totalFeeRate(price));

  if (price > CUSTOMS_SAFE_PRICE_USD && price <= CUSTOMS_DISCOUNT_BAND_UPPER_USD) {
    price = CUSTOMS_ROUNDED_PRICE_USD;
  }

  return price.toFixed(2);
}

// "Üstü çizili" (eski/indirim) fiyat — kullanıcı isteğiyle her üründe satış fiyatının
// %30-%50 üzerinde, rastgele (ürün başına ayrı) bir değer olacak şekilde üretiliyor;
// hepsi aynı oranda olmasın diye her çağrıda yeniden rastgele seçiliyor.
export function computeOldPrice(price: string | number): string {
  const sale = Number(price);
  if (!sale || Number.isNaN(sale)) return "";
  const markup = 0.3 + Math.random() * 0.2; // %30 - %50
  return (sale * (1 + markup)).toFixed(2);
}

export interface PriceBreakdown {
  costUsd: number;
  shippingUsd: number;
  recommendedPriceUsd: number;
  actualPriceUsd: number;
  profitUsd: number;
  marginPct: number; // alış fiyatına göre (kâr / alış × 100)
}

// Fiyat hesaplayıcı modalı için — önerilen fiyatın yanında kullanıcının girdiği (ya da
// önerilenle aynı) bir satış fiyatına göre kâr/marj dökümü çıkarır. Ozon Fiyat Hesaplayıcı
// tarayıcı eklentisindeki (ozon-fiyat-hesaplayici/content.js) recalcBreakdown() ile aynı mantık.
export function computePriceBreakdown(
  costPrice: string | number,
  weightGrams?: number | null,
  dimsCm?: { widthCm?: number | null; heightCm?: number | null; depthCm?: number | null },
  actualPriceOverrideUsd?: number,
): PriceBreakdown | null {
  const cost = Number(costPrice);
  if (!cost || Number.isNaN(cost)) return null;

  const billingWeight = weightGrams
    ? computeBillingWeightGrams(weightGrams, dimsCm?.widthCm, dimsCm?.heightCm, dimsCm?.depthCm)
    : 0;
  const shippingUsd = billingWeight ? estimateShippingCostUsd(billingWeight) : 0;

  const recommendedStr = computeSalePrice(costPrice, weightGrams, dimsCm);
  const recommendedPriceUsd = recommendedStr ? Number(recommendedStr) : 0;

  const actualPriceUsd = actualPriceOverrideUsd ?? recommendedPriceUsd;
  if (!actualPriceUsd) {
    return { costUsd: cost, shippingUsd, recommendedPriceUsd, actualPriceUsd: 0, profitUsd: 0, marginPct: 0 };
  }

  const netAfterFees = actualPriceUsd * (1 - totalFeeRate(actualPriceUsd));
  const profitUsd = netAfterFees - shippingUsd - cost;
  const marginPct = (profitUsd / cost) * 100;

  return { costUsd: cost, shippingUsd, recommendedPriceUsd, actualPriceUsd, profitUsd, marginPct };
}
