// Fiyat formülü (2026-07-29, kullanıcıdan alınan gerçek parametreler).

// Ürün özelliklerindeki ağırlık paketleme/kutu ağırlığını içermiyor — kargo hesabında
// gerçek gönderi ağırlığını hafife almamak için %35 pay + 10g sabit paketleme ağırlığı ekliyoruz
// (2026-08-03 itibarıyla %20'den %35 + 10g'a yükseltildi, kullanıcı talebiyle).
const PACKAGING_WEIGHT_BUFFER = 1.35;
const PACKAGING_WEIGHT_EXTRA_GRAMS = 10;

// %35'lik pay 300g'ın üzerinde gerçekçi değil — patpat/kargo poşeti/kendi ambalajı gibi
// paketleme malzemeleri ürün ağırlığıyla ORANTILI büyümüyor, kabaca sabit kalıyor (300g'lık bir
// ürünle 1000g'lık bir ürünün poşet/patpat boyutu birbirine yakın). Doğrusal %35 payını yüksek
// gramajda da uygulamaya devam edersek ürün gerçekte ASE'nin Extra Small/Express eşiği olan
// 500g'ın altında kalacakken bizim payımız onu yapay olarak Express tarifesine (çok daha pahalı)
// düşürüyordu (örn. 400g ürün 550g faturalanıp Express'e atlıyordu). Bu yüzden 300g'ın üzerinde
// yüzdesel pay yerine, 300g'da hesaplanan SABİT paketleme ağırlığını (115g) ekliyoruz — ağırlık
// arttıkça pay da büyümüyor, gerçeğe daha yakın (2026-08-03, kullanıcı talebi).
const PACKAGING_WEIGHT_THRESHOLD_GRAMS = 300;

// Metal kutu/ağır ambalaj gibi standart dışı ürünlerde normal paketleme yüzdesi (%35) yetersiz
// kalıyor — ürün "ağır ambalaj" olarak işaretlenirse pay %65'e çıkarılıyor. Sabit 10g'lık ek pay
// bundan etkilenmiyor, sadece yüzdesel kısım büyüyor.
// (2026-08-04, kullanıcı talebi — önce 2.5x/%87.5 denendi, sonra %60'a, en son %65'e sabitlendi.)
const HEAVY_PACKAGING_BUFFER = 1.65;

function packagingBufferRate(heavyPackaging: boolean): number {
  return heavyPackaging ? HEAVY_PACKAGING_BUFFER : PACKAGING_WEIGHT_BUFFER;
}

function extraGramsAtThreshold(bufferRate: number): number {
  return PACKAGING_WEIGHT_THRESHOLD_GRAMS * (bufferRate - 1) + PACKAGING_WEIGHT_EXTRA_GRAMS;
}

// ASE'nin PDF tarifesinde: kenarların toplamı ≤90cm ise fiziksel ağırlık, >90cm ise fiziksel
// veya hacimsel ağırlıktan HANGİSİ BÜYÜKSE o kullanılır. Hacimsel ağırlık formülü: en×boy×
// yükseklik (cm) ÷ 5000 = kg. Fiziksel ağırlığa önce paketleme payı + sabit paketleme grafı ekleniyor.
export function computeBillingWeightGrams(
  weightGrams: number,
  widthCm?: number | null,
  heightCm?: number | null,
  depthCm?: number | null,
  heavyPackaging?: boolean,
): number {
  const bufferRate = packagingBufferRate(!!heavyPackaging);
  const bufferedWeight =
    weightGrams <= PACKAGING_WEIGHT_THRESHOLD_GRAMS
      ? weightGrams * bufferRate + PACKAGING_WEIGHT_EXTRA_GRAMS
      : weightGrams + extraGramsAtThreshold(bufferRate);
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

const MARGIN_RATE = 0.65; // alış fiyatı üzerine %65 marj (2026-08-13'te %40'tan önce %60'a,
// sonra %65'e yükseltildi, kullanıcı talebi — eski %40 marj artık aşağıdaki
// MIN_PRICE_MARGIN_RATE ile min_price'a taşındı)
// Alış fiyatı $1'ın altındaki ürünlerde %40 marj mutlak olarak çok küçük kalıyor (örn. $0.29
// alışta ~$0.10 kâr) — bir iade/hasar/ekstra kesinti tek işlemde bunu sıfırlıyor. Bu yüzden
// düşük alış fiyatlı ürünlerde marjı %65'e çıkarıyoruz (2026-08-03, kullanıcı talebi).
const LOW_COST_MARGIN_RATE = 0.65;
const LOW_COST_THRESHOLD_USD = 1;

// Ozon'un "min_price" alanı — sistemin otomatik promosyon/indirim mekanizmasının fiyatı
// bunun altına düşürmesine izin vermediği taban fiyat. Eskiden buraya normal satış fiyatının
// aynısı gönderiliyordu (bkz. src/ozon/products.ts yorumu — sadece Ozon'un old_price'ı
// reddetmesini önlemek içindi). 2026-08-13'te kullanıcı talebiyle gerçek bir taban haline
// getirildi: eski %40 normal marj artık min_price'ın marjı oldu, normal fiyat %60'a çıktı.
const MIN_PRICE_MARGIN_RATE = 0.4;

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

// computeSalePrice ve computeMinPrice arasında paylaşılan asıl formül — tek fark uygulanan marj oranı.
function computePriceForMargin(
  marginRate: number,
  costPrice: string | number,
  weightGrams?: number | null,
  dimsCm?: { widthCm?: number | null; heightCm?: number | null; depthCm?: number | null },
  heavyPackaging?: boolean,
  cargoWeightOverrideGrams?: number | null,
): string {
  const cost = Number(costPrice);
  if (!cost || Number.isNaN(cost)) return "";

  const billingWeight =
    cargoWeightOverrideGrams ??
    (weightGrams
      ? computeBillingWeightGrams(weightGrams, dimsCm?.widthCm, dimsCm?.heightCm, dimsCm?.depthCm, heavyPackaging)
      : 0);
  const shipping = billingWeight ? estimateShippingCostUsd(billingWeight) : 0;
  const target = cost * (1 + marginRate) + shipping;

  // Lojistik hizmet bedeli tavanlı olduğu için oran fiyata bağlı — bir kere kabaca hesaplayıp,
  // bulunan fiyatla oranı yeniden hesaplayarak (tavan dahil) düzeltiyoruz.
  let price = target / (1 - (COMMISSION_RATE + LOGISTICS_SERVICE_RATE + BANK_FEE_RATE));
  price = target / (1 - totalFeeRate(price));

  if (price > CUSTOMS_SAFE_PRICE_USD && price <= CUSTOMS_DISCOUNT_BAND_UPPER_USD) {
    price = CUSTOMS_ROUNDED_PRICE_USD;
  }

  return price.toFixed(2);
}

export function computeSalePrice(
  costPrice: string | number,
  weightGrams?: number | null,
  dimsCm?: { widthCm?: number | null; heightCm?: number | null; depthCm?: number | null },
  heavyPackaging?: boolean,
  // Kullanıcı kargo ağırlığını elle düzelttiyse (Product.cargoWeightGrams), formülün kendi
  // hesapladığı değeri (net ağırlık + paketleme payı) YOK SAYIP doğrudan bunu kullanır.
  cargoWeightOverrideGrams?: number | null,
): string {
  const cost = Number(costPrice);
  if (!cost || Number.isNaN(cost)) return "";
  return computePriceForMargin(marginRateForCost(cost), costPrice, weightGrams, dimsCm, heavyPackaging, cargoWeightOverrideGrams);
}

// Ozon'a min_price olarak gönderilecek taban fiyat — sabit %40 marj (bkz. MIN_PRICE_MARGIN_RATE
// yorumu). marginRateForCost'taki düşük-alış-fiyatı %65 istisnası burada UYGULANMIYOR; min_price
// her zaman sabit %40'a dayanıyor, normal fiyatla arasındaki fark ürün alış fiyatından bağımsız tutuluyor.
export function computeMinPrice(
  costPrice: string | number,
  weightGrams?: number | null,
  dimsCm?: { widthCm?: number | null; heightCm?: number | null; depthCm?: number | null },
  heavyPackaging?: boolean,
  cargoWeightOverrideGrams?: number | null,
): string {
  return computePriceForMargin(MIN_PRICE_MARGIN_RATE, costPrice, weightGrams, dimsCm, heavyPackaging, cargoWeightOverrideGrams);
}

// "Üstü çizili" (eski/indirim) fiyat — satış fiyatı, bu fiyata rastgele %15-%20 arası bir
// indirim uygulanmış hali olacak şekilde GERİYE hesaplanıyor (satış = eski × 0.80-0.85 arası,
// yani eski = satış ÷ 0.80-0.85). Hepsi aynı oranda olmasın diye her çağrıda yeniden rastgele
// seçiliyor (2026-08-13'te kullanıcı talebiyle %30-50 "üzerine ekle" mantığından bu şekle
// değiştirildi — önceki mantık indirim yerine kâr üstüne rastgele zam gibi görünüyordu).
export function computeOldPrice(price: string | number): string {
  const sale = Number(price);
  if (!sale || Number.isNaN(sale)) return "";
  const discountFactor = 0.8 + Math.random() * 0.05; // satış = eski × (0.80 - 0.85)
  return (sale / discountFactor).toFixed(2);
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
  heavyPackaging?: boolean,
  cargoWeightOverrideGrams?: number | null,
): PriceBreakdown | null {
  const cost = Number(costPrice);
  if (!cost || Number.isNaN(cost)) return null;

  const billingWeight =
    cargoWeightOverrideGrams ??
    (weightGrams
      ? computeBillingWeightGrams(weightGrams, dimsCm?.widthCm, dimsCm?.heightCm, dimsCm?.depthCm, heavyPackaging)
      : 0);
  const shippingUsd = billingWeight ? estimateShippingCostUsd(billingWeight) : 0;

  const recommendedStr = computeSalePrice(costPrice, weightGrams, dimsCm, heavyPackaging, cargoWeightOverrideGrams);
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
