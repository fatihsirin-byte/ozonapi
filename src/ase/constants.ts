// Hem sunucu tarafında (src/ase/orderShipment.ts) hem istemci bileşeninde
// (app/orders/[postingNumber]/AseShipmentButton.tsx) kullanılıyor — bağımlılığı olmayan ayrı bir
// dosyada tutuluyor ki client component prisma/db gibi sunucuya özel kod içeren orderShipment.ts'i
// import etmek zorunda kalmasın (2026-09-13 code review'da tespit edildi: sabit iki yerde ayrı ayrı
// tanımlıysa biri değişip diğeri unutulabilir).
export const HSCODE_ERROR_CODE = "34";

// ASE'nin hata kod tablosu güvenilir değil: gerçek bir gönderimde ("HS Code mus be 12 digit")
// HS koduyla ilgili bir hatayı "34" (Geçersiz Gtip kodu) yerine "31" (normalde "x alanı boş
// olamaz" için kullanılan genel kod) ile döndürdü (2026-09-15'te canlıda tespit edildi — daha
// önce "Etgb" şipmentType örneğinin de yanlış çıkması gibi, dokümana tam güvenilemiyor). Bu
// yüzden sadece kod numarasına değil, hata METNİNE de bakıyoruz — "HS"/"Gtip" geçen HERHANGİ bir
// hata, kodu ne olursa olsun, kullanıcıya düzelt-ve-tekrar-dene popup'ını açtırıyor.
export function isHsCodeError(errorCode: string | null | undefined, message: string | null | undefined): boolean {
  if (errorCode === HSCODE_ERROR_CODE) return true;
  // DİKKAT: düz .toLowerCase() Türkçe büyük "İ"yi (U+0130) "i" + görünmez bir birleşik nokta
  // işaretine (U+0307) çevirir, "i" harfine DEĞİL — bu yüzden "GTİP kodu..." gibi bir mesajda
  // .toLowerCase().includes("gtip") SESSİZCE false dönerdi (2026-09-15 code review'da tespit
  // edildi — tam olarak bu düzeltmenin çözmeye çalıştığı hata sınıfı). NFKD normalize + birleşik
  // işaretleri temizlemek "İ"yi düz "i"ye indirger.
  const text = (message ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return text.includes("hs code") || text.includes("hs kod") || text.includes("gtip");
}
