// Kolajen/vitamin/takviye gibi ürünler stok senkronunun DIŞINDA tutulacak (2026-09-26, kullanıcı
// kararı: "shopify stokları source of truth olcak, kolajen ve vitamin vs gibi ürünler hariç").
// Bu ürünler için shopifyVendor/shopifyType alanları DB'de hiç doldurulmamış (CSV'de boştu,
// bkz. 2026-09-26 tarihli SKU denetimi) — bu yüzden kategori/vendor'a göre değil, ürün adı/handle
// içindeki anahtar kelimelere göre eşleştiriliyor. Bu heuristik KESİN değil, yanlış pozitif/negatif
// verebilir — canlıya almadan önce eşleşen ürün listesi kullanıcıya gösterilip onaylatılmalı.
const EXCLUDED_KEYWORDS = [
  "collagen",
  "kolajen",
  "vitamin",
  "vita1", // day2day serisi SKU'ları (VITA1008-1011) bu önekle başlıyor, bkz. önceki denetim
  "supplement",
  "takviye",
  "glutathione",
  "hyaluronic",
  "ch alpha",
];

export function isExcludedFromStockSync(input: { sku: string; handle: string; title: string }): boolean {
  const haystack = `${input.sku} ${input.handle} ${input.title}`.toLowerCase();
  return EXCLUDED_KEYWORDS.some((keyword) => haystack.includes(keyword));
}
