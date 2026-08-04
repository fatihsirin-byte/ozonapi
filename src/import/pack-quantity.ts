// Shopify varyant option metninden ("1 Display - 24 Pieces x 35g", "1 Box - 6 Displays - 72 Bars"
// gibi) toplam SATILABİLİR birim adedini (unitsInPack) çıkarır — Ozon'un varyant birleştirme
// kuralı (8962 "Birimler tek bir üründe") için gerekli, CSV'de ayrı bir kolon olarak gelmiyor.
export function extractPackQuantity(optionText: string): number | null {
  const text = optionText.trim();
  if (!text) return null;

  const UNIT_WORDS =
    "pieces?|pcs?|bars?|packs?|cups?|bottles?|capsules?|sachets?|tablets?|sets?|servings?|boxes?|bags?|cans?";

  // Öncelik: "<sayı> Piece(s)/Bar(s)/..." — bu her zaman TOPLAM birim adedidir, parantez
  // içindeki "(N Displays)" gibi alt-gruplama sayılarından ayırt etmek için ilk eşleşmeyi alıyoruz
  // (metinlerde toplam adet parantez öncesi, alt-gruplama parantez içinde geliyor).
  const directMatch = text.match(new RegExp(`(\\d+)\\s*(?:mystery\\s+)?(?:${UNIT_WORDS})\\b`, "i"));
  if (directMatch) return Number(directMatch[1]);

  // "1 Display (24 Bars)" gibi parantez içinde tek eşleşme.
  const parenMatch = text.match(new RegExp(`\\((\\d+)\\s*(?:${UNIT_WORDS})\\)`, "i"));
  if (parenMatch) return Number(parenMatch[1]);

  // "30 Capsules - 1 Box" gibi UNIT sayısı "Box/Display" kelimesinden ÖNCE geliyorsa.
  const beforeMatch = text.match(new RegExp(`(\\d+)\\s*(?:${UNIT_WORDS})\\s*[-–]\\s*1\\s*(?:box|display)`, "i"));
  if (beforeMatch) return Number(beforeMatch[1]);

  // "12g x 30 - Box" gibi "x <sayı> - Box" formatı.
  const xBeforeBoxMatch = text.match(/x\s*(\d+)\s*[-–]\s*box/i);
  if (xBeforeBoxMatch) return Number(xBeforeBoxMatch[1]);

  // "1 Box (Pack of 12)" formatı.
  const packOfMatch = text.match(/pack of (\d+)/i);
  if (packOfMatch) return Number(packOfMatch[1]);

  return null;
}

// Bir varyantın "bulk pack" (Display/Box vb.) olup olmadığını, tekil ürün varyantından ayırt eder.
export function isBulkPackVariant(optionText: string): boolean {
  return /display|\bbox\b|\bcase\b/i.test(optionText);
}
