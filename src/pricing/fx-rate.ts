// PNL'de Ozon'un gerçek kargo kesintisi (₽) kâr/zarar hesabına katılırken $'a çevrilmesi için —
// sabit tahmini bir kur yerine (bkz. 2026-08-14 para birimi hatası, ₽'yi $ sanıp 80 kat büyük
// göstermişti) her gün güncel gerçek kuru çekiyoruz. Kaynak: exchangerate-api.com'un ücretsiz,
// API anahtarı gerektirmeyen ucu — günlük güncelleniyor, ticari işlem için değil sadece
// raporlama/gösterim amaçlı kullanıldığından yeterli hassasiyette (2026-09-09, kullanıcı talebi).
const FX_API_URL = "https://api.exchangerate-api.com/v4/latest/USD";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

let cached: { rate: number; fetchedAt: number } | null = null;

// Kur çekilemezse (ağ hatası vb.) null döner — çağıran taraf bu durumda gerçek ₽ verisini
// dolar kâr hesabına katmak yerine mevcut tahmini formüle düşer (bkz. pnl-report.service.ts),
// sayfa asla bu yüzden çökmez.
export async function getUsdToRubRate(): Promise<number | null> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate;
  }
  try {
    const res = await fetch(FX_API_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return cached?.rate ?? null;
    const data = (await res.json()) as { rates?: { RUB?: number } };
    const rate = data.rates?.RUB;
    if (!rate || rate <= 0) return cached?.rate ?? null;
    cached = { rate, fetchedAt: Date.now() };
    return rate;
  } catch {
    return cached?.rate ?? null;
  }
}
