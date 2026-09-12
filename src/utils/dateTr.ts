// Ozon'un analitik uç noktasındaki "day" dimension'ı Moskova saatine (MSK, UTC+3, yıl boyu sabit —
// DST yok) göre gruplanıyor; Türkiye de 2016'dan beri yıl boyu sabit UTC+3 (DST yok) — yani iki
// saat dilimi sayısal olarak HER ZAMAN eşleşiyor. Bu yüzden "Bugün" filtresi ve gün bazlı gruplama
// için TEK, paylaşılan bir "Europe/Istanbul takvim günü" hesaplayıcısı kullanıyoruz — hem tarayıcıda
// (Analitik sayfasının filtre aralığını hesaplarken) hem sunucuda (yerel sipariş verisini Ozon'un
// gün anahtarlarıyla eşleştirirken) aynı fonksiyon kullanılıyor ki ikisi arasında saat dilimi
// kayması yüzünden tutarsızlık (ör. UTC'ye göre "dün" sayılan bir siparişin İstanbul'da aslında
// "bugün" olması) çıkmasın (2026-09-12, kullanıcı talebi: "Bugün" filtresi + günlük ciro grafiğine
// sipariş/ürün adedi).
const ISTANBUL_TZ = "Europe/Istanbul";

// en-CA locale'i tarihi doğrudan YYYY-MM-DD formatında veriyor — Intl.DateTimeFormat hem tarayıcıda
// hem Node'da (full-ICU varsayılan olarak gelir) timeZone parametresini destekliyor.
export function istanbulDateStr(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Bir "YYYY-MM-DD" Türkiye takvim gününün başlangıç/bitiş anlarını (gerçek UTC Date olarak) döner —
// Türkiye sabit UTC+3 olduğu için bu her zaman o günün 00:00:00.000+03:00 / 23:59:59.999+03:00'ı.
// Yerel sipariş verisini (Order.orderDate, UTC instant) bu aralıkla sorgulayıp sonra
// istanbulDateStr ile aynı takvim gününe grupluyoruz.
export function istanbulDayBoundsUtc(dateStr: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateStr}T00:00:00.000+03:00`),
    end: new Date(`${dateStr}T23:59:59.999+03:00`),
  };
}
