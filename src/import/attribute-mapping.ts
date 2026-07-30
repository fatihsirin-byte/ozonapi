import { METAFIELD_COLUMNS } from "./shopify-csv";

// Ozon attribute adında geçen kelime kalıpları → shopifyMetafields anahtarı.
// Amaç: kategori attribute formunu, Shopify CSV'sindeki metafield değerleriyle ücretsiz
// (AI kullanmadan, salt string eşleştirmeyle) ön doldurmak. Eşleşme yoksa kullanıcı elle girer.
const ATTRIBUTE_NAME_PATTERNS: { patterns: RegExp[]; metafieldKey: keyof typeof METAFIELD_COLUMNS }[] = [
  { patterns: [/вкус/i, /flavor/i, /aroma/i], metafieldKey: "flavor" },
  { patterns: [/тип шоколад/i, /chocolate type/i], metafieldKey: "chocolateType" },
  { patterns: [/цвет/i, /^color/i], metafieldKey: "color" },
  { patterns: [/страна/i, /country/i], metafieldKey: "country" },
  { patterns: [/бренд/i, /^brand/i], metafieldKey: "brand" },
  { patterns: [/аллерген/i, /allergen/i], metafieldKey: "allergenInformation" },
  { patterns: [/диет/i, /dietary/i], metafieldKey: "dietaryPreferences" },
  { patterns: [/возраст/i, /age group/i], metafieldKey: "recommendedAgeGroup" },
  { patterns: [/пол/i, /target gender/i], metafieldKey: "targetGender" },
  { patterns: [/материал.*ювелир/i, /jewelry material/i], metafieldKey: "jewelryMaterial" },
  { patterns: [/тип.*ювелир/i, /jewelry type/i], metafieldKey: "jewelryType" },
  { patterns: [/форма продукта/i, /product form/i], metafieldKey: "productForm" },
];

/**
 * Verilen bir Ozon attribute adı için, üründeki Shopify metafield değerlerinden
 * eşleşen bir değer varsa döndürür; yoksa null (attribute manuel doldurulmalı).
 */
export function suggestAttributeValue(
  attributeName: string,
  shopifyMetafields: Record<string, string> | null | undefined,
  vendor?: string | null,
): string | null {
  for (const { patterns, metafieldKey } of ATTRIBUTE_NAME_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(attributeName))) {
      const value = shopifyMetafields?.[metafieldKey];
      if (value) return value;
      // "Brand (custom metafield)" doldurulmamışsa, Shopify'ın ayrı Vendor alanına düş —
      // çoğu üründe marka bilgisi metafield'de değil Vendor'da tutuluyor.
      if (metafieldKey === "brand" && vendor) return vendor;
    }
  }

  return null;
}
