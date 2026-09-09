// PNL'de Ozon'un gerçek kargo kesintisi (₽) kâr/zarar hesabına katılırken $'a çevrilmesi için —
// sabit tahmini bir kur yerine (bkz. 2026-08-14 para birimi hatası, ₽'yi $ sanıp 80 kat büyük
// göstermişti) her gün güncel gerçek kuru çekiyoruz. Aynı kur cevabı Paraşüt faturalarında
// USD satış fiyatını TL'ye çevirmek için de kullanılıyor (2026-09-09, kullanıcı talebi: "o günün
// tl kurundan doları tl çevirerek"). Kaynak: exchangerate-api.com'un ücretsiz, API anahtarı
// gerektirmeyen ucu — günlük güncelleniyor.
const FX_API_URL = "https://api.exchangerate-api.com/v4/latest/USD";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

let cached: { rates: Record<string, number>; fetchedAt: number } | null = null;

async function getRates(): Promise<Record<string, number> | null> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rates;
  }
  try {
    const res = await fetch(FX_API_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return cached?.rates ?? null;
    const data = (await res.json()) as { rates?: Record<string, number> };
    if (!data.rates) return cached?.rates ?? null;
    cached = { rates: data.rates, fetchedAt: Date.now() };
    return cached.rates;
  } catch {
    return cached?.rates ?? null;
  }
}

// Kur çekilemezse (ağ hatası vb.) null döner — çağıran taraf bu durumda gerçek ₽ verisini
// dolar kâr hesabına katmak yerine mevcut tahmini formüle düşer (bkz. pnl-report.service.ts),
// sayfa asla bu yüzden çökmez.
export async function getUsdToRubRate(): Promise<number | null> {
  const rates = await getRates();
  const rate = rates?.RUB;
  return rate && rate > 0 ? rate : null;
}

export async function getUsdToTryRate(): Promise<number | null> {
  const rates = await getRates();
  const rate = rates?.TRY;
  return rate && rate > 0 ? rate : null;
}
