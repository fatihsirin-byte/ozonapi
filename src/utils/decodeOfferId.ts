// Next.js, [offerId] gibi dinamik route segmentlerini OTOMATİK ÇÖZMÜYOR (decode etmiyor) —
// offerId'de Türkçe'ye özgü harf (ör. noktasız "ı") varsa params.offerId bize hâlâ yüzde-kodlu
// haliyle geliyor ve DB'deki düz değerle eşleşmiyor (bkz. BEKLEYEN-GELISTIRMELER.md #2,
// 2026-09-10). Bazı offerId'lerde (ör. "TURKOBABA-100%-342G-6974") literal "%" karakteri de
// bulunduğu için decodeURIComponent bozuk bir dizi üzerinde çağrılırsa hata fırlatabilir —
// bu yüzden burada güvenli sarmalanıyor; hata olursa null dönüp çağıran tarafın "bulunamadı"
// olarak ele alması bekleniyor (2026-09-10'da code review'da tespit edildi).
export function decodeOfferId(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

// offerId'yi URL'e gömen her yerde (Link href, fetch) encodeURIComponent kullanmayı UNUTMAK, bu
// dosyadaki decodeOfferId'nin çözdüğü aynı 404/500 hatasını geri getiriyor — bir kez
// (app/api/import/variant/[offerId]/route.ts'te) zaten atlanmıştı (2026-09-10'da code review'da
// tespit edildi). Serbest `${encodeURIComponent(offerId)}` şablon yazmak yerine bu üç fonksiyon
// kullanılmalı ki encode etmeyi unutmak yapısal olarak imkansız olsun.
export function productPath(offerId: string): string {
  return `/products/${encodeURIComponent(offerId)}`;
}

export function productApiPath(offerId: string, suffix = ""): string {
  return `/api/products/${encodeURIComponent(offerId)}${suffix}`;
}

export function variantApiPath(offerId: string): string {
  return `/api/import/variant/${encodeURIComponent(offerId)}`;
}
