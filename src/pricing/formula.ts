// Fiyat formülü (2026-07-29, kullanıcıdan alınan gerçek parametreler).

// ASE & GBS tarifesi — ASE'nin kendi PDF tarife tablolarından (gram bazlı lookup) birebir
// türetilmiş doğrusal formüller. Economy tier'i yok: 500g altı Extra Small, üstü Express DG
// (batarya/sıvıya da izin veren hat — ürün tipine bakılmaksızın her zaman kabul edilir, standart
// Express'ten biraz daha pahalı ama garanti çalışır).
export function estimateShippingCostUsd(weightGrams: number): number {
  if (weightGrams <= 500) {
    // ASE & GBS Extra Small Express TR (PDF ile doğrulandı): $0.80 + $0.0055/1g
    return 0.8 + 0.0055 * weightGrams;
  }
  // ASE & GBS Express DG TR (PDF ile doğrulandı, batarya/sıvı dahil): $3.00 + $0.7/100g, maks 25kg
  return 3.0 + 0.7 * (weightGrams / 100);
}

const MARGIN_RATE = 0.4; // alış fiyatı üzerine %40 marj
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

export function computeSalePrice(costPrice: string | number, weightGrams?: number | null): string {
  const cost = Number(costPrice);
  if (!cost || Number.isNaN(cost)) return "";

  const shipping = weightGrams ? estimateShippingCostUsd(weightGrams) : 0;
  const target = cost * (1 + MARGIN_RATE) + shipping;

  // Lojistik hizmet bedeli tavanlı olduğu için oran fiyata bağlı — bir kere kabaca hesaplayıp,
  // bulunan fiyatla oranı yeniden hesaplayarak (tavan dahil) düzeltiyoruz.
  let price = target / (1 - (COMMISSION_RATE + LOGISTICS_SERVICE_RATE + BANK_FEE_RATE));
  price = target / (1 - totalFeeRate(price));

  if (price > CUSTOMS_SAFE_PRICE_USD && price <= CUSTOMS_DISCOUNT_BAND_UPPER_USD) {
    price = CUSTOMS_ROUNDED_PRICE_USD;
  }

  return price.toFixed(2);
}
