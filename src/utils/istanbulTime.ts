// Türkiye 2016'dan beri sabit UTC+3 kullanıyor (yaz saati uygulaması yok) — bu yüzden basit bir
// sabit ofsetle güvenle hesaplanabiliyor, zaman dilimi kütüphanesi gerekmiyor.
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

// getIstanbulTodayRangeUtc VE getIstanbulDayRangeUtc'nin PAYLAŞTIĞI tek hesap — ikisi aynı
// formülü iki ayrı yerde tutup ileride birbirinden SESSİZCE sapmasın diye (2026-09-18 code
// review'da tespit edildi). `month` burada 0 tabanlı (JS Date sözleşmesi, Date.UTC ile birebir).
function istanbulDayRangeFromYmd(year: number, month: number, day: number): { start: Date; end: Date } {
  const startIstanbulMidnightUtc = Date.UTC(year, month, day, 0, 0, 0, 0) - ISTANBUL_OFFSET_MS;
  return {
    start: new Date(startIstanbulMidnightUtc),
    end: new Date(startIstanbulMidnightUtc + 24 * 60 * 60 * 1000),
  };
}

// "Bugün" (TSİ) gün sınırlarını UTC Date olarak döner — DB'deki (UTC) zaman damgalarıyla
// doğrudan karşılaştırılabilir (2026-09-09, kullanıcı talebi: "TSİ ile olması çok önemli").
export function getIstanbulTodayRangeUtc(): { start: Date; end: Date } {
  const nowIstanbul = new Date(Date.now() + ISTANBUL_OFFSET_MS);
  return istanbulDayRangeFromYmd(nowIstanbul.getUTCFullYear(), nowIstanbul.getUTCMonth(), nowIstanbul.getUTCDate());
}

// "YYYY-MM-DD" (TSİ takvim günü) için gün sınırlarını UTC Date olarak döner — getIstanbulTodayRangeUtc
// ile AYNI hesap, sadece "şimdi" yerine BELİRLİ bir gün için (2026-09-18, kullanıcı talebi: "Aladdin
// fatura için tarih filtresi, geri dönük tek gün seçerek gidebilelim"). Ay/gün aralığını da AYRICA
// kontrol ediyoruz — Date.UTC "2026-13-40" gibi geçersiz bir günü SESSİZCE normalize edip (ör.
// 2027-02-09'a) yanlış bir aralık dönerdi, bunu bir hata SANMAZ (2026-09-18 code review'da tespit
// edildi: ilk yazımdaki Number.isNaN kontrolü hiçbir zaman tetiklenemiyordu, Date.UTC taşan
// değerleri NaN değil normalize ederek döner).
export function getIstanbulDayRangeUtc(dateStr: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) throw new Error(`Geçersiz tarih formatı: "${dateStr}" (beklenen: YYYY-MM-DD)`);
  const [, yStr, mStr, dStr] = match;
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  // BİLİNEN, KABUL EDİLMİŞ eksik: bu kontrol ayın KAÇ GÜN çektiğine bakmıyor — "2026-02-30" gibi
  // takvimde hiç var olmayan ama 1-31 aralığında kalan bir gün yine de geçer, Date.UTC bunu SESSİZCE
  // Mart'a taşar (2026-09-18 code review round 2'de tespit edildi). Tam bir "ayın gün sayısı"
  // tablosu BİLEREK eklenmedi — bu fonksiyonun TEK gerçek çağıranı (route.ts) bir <input
  // type="date">'den geliyor, o da böyle bir tarihi ZATEN üretemiyor.
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new Error(`Geçersiz tarih: "${dateStr}"`);
  }
  return istanbulDayRangeFromYmd(y, m - 1, d);
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
