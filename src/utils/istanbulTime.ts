// Türkiye 2016'dan beri sabit UTC+3 kullanıyor (yaz saati uygulaması yok) — bu yüzden basit bir
// sabit ofsetle güvenle hesaplanabiliyor, zaman dilimi kütüphanesi gerekmiyor.
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

// "Bugün" (TSİ) gün sınırlarını UTC Date olarak döner — DB'deki (UTC) zaman damgalarıyla
// doğrudan karşılaştırılabilir (2026-09-09, kullanıcı talebi: "TSİ ile olması çok önemli").
export function getIstanbulTodayRangeUtc(): { start: Date; end: Date } {
  const nowIstanbul = new Date(Date.now() + ISTANBUL_OFFSET_MS);
  const y = nowIstanbul.getUTCFullYear();
  const m = nowIstanbul.getUTCMonth();
  const d = nowIstanbul.getUTCDate();
  const startIstanbulMidnightUtc = Date.UTC(y, m, d, 0, 0, 0, 0) - ISTANBUL_OFFSET_MS;
  return {
    start: new Date(startIstanbulMidnightUtc),
    end: new Date(startIstanbulMidnightUtc + 24 * 60 * 60 * 1000),
  };
}
