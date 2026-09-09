// Toplu içe aktarımda varyantlı ürün adları `${başlık} - ${varyant değerleri}` şeklinde kuruluyor
// (bkz. src/import/import-products.ts) — ilk " - " öncesini almak sade/varyantsız başlığı verir.
// Ayrı bir "temiz ad" alanı DB'de tutulmuyor, bu yüzden isim üzerinden sezgisel olarak çıkarılıyor.
export function stripVariantSuffix(name: string): string {
  const idx = name.indexOf(" - ");
  return idx === -1 ? name : name.slice(0, idx);
}
