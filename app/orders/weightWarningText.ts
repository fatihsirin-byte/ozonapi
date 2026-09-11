// Tekli ("Topla" butonu) ve toplu paketleme sihirbazında AYNI metin gösterilmeli — tek bir yerden
// paylaşılıyor ki biri değişip diğeri unutulmasın (2026-09-11'de code review'da tespit edildi:
// aynı metin iki dosyada ayrı ayrı yazılmıştı).
export const WEIGHT_WARNING_TEXT =
  '⚠ Bu sipariş "500g altı" lojistik deposundan geldi ve birden fazla farklı ürün içeriyor — siparişteki ürünler 500 gramdan fazla ise lütfen bölünüz.';
