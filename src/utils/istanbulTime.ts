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

// Bir Date'in TSİ'ye göre takvim gününü "YYYY-MM-DD" olarak döner — dış bir API'ye (ör. ASE)
// "bugünün tarihi" gibi bir gün sınırı göndermek için. UTC ile hesaplansaydı gece yarısından
// sonraki ~3 saatlik pencerede bir gün geride kalırdı (2026-09-16 code review'da
// src/ase/statusPolling.ts'te tespit edildi — bu dosyadaki getIstanbulTodayRangeUtc'nin aynı
// UTC+3 ofset mantığını paylaşıyor).
export function toIstanbulDateString(date: Date): string {
  const shifted = new Date(date.getTime() + ISTANBUL_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
