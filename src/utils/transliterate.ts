// Rusça (Kiril) isim/adresleri Türk faturasında kullanılabilmesi için Latin harflerine çevirir.
// Standart pratik transliterasyon tablosu (ISO 9 değil, GOST/pratik kullanım — faturada okunabilirlik amaçlı).
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

export function transliterateRussian(text: string): string {
  return text
    .split("")
    .map((ch) => {
      const lower = ch.toLowerCase();
      const mapped = CYRILLIC_TO_LATIN[lower];
      if (mapped == null) return ch;
      return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    })
    .join("");
}
