// Rusça (Kiril) isim/adresleri Türk faturasında kullanılabilmesi için Latin harflerine çevirir.
// Standart pratik transliterasyon tablosu (ISO 9 değil, GOST/pratik kullanım — faturada okunabilirlik amaçlı).
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

// Bilinen büyük şehir/bölge adları harf harf transliterasyon yerine Türkçe'de yerleşik
// (yaygın kullanılan) adlarıyla yazılır — örn. "Москва" harfi harfine "Moskva" değil "Moskova".
const KNOWN_PLACE_NAMES: Record<string, string> = {
  "москва": "Moskova",
  "санкт-петербург": "Sankt Peterburg",
  "петербург": "Peterburg",
  "новосибирск": "Novosibirsk",
  "екатеринбург": "Yekaterinburg",
  "казань": "Kazan",
  "нижний новгород": "Nijniy Novgorod",
  "челябинск": "Çelyabinsk",
  "самара": "Samara",
  "омск": "Omsk",
  "ростов-на-дону": "Rostov-na-Donu",
  "уфа": "Ufa",
  "красноярск": "Krasnoyarsk",
  "воронеж": "Voronej",
  "пермь": "Perm",
  "волгоград": "Volgograd",
  "краснодар": "Krasnodar",
  "саратов": "Saratov",
  "тюмень": "Tümen",
  "крым": "Kırım",
  "россия": "Rusya",
};

function transliterateLetters(text: string): string {
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

export function transliterateRussian(text: string): string {
  const known = KNOWN_PLACE_NAMES[text.trim().toLowerCase()];
  if (known) return known;
  return transliterateLetters(text);
}
