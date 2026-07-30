import { parse } from "csv-parse/sync";

// Ozon attribute ön-doldurmasında kullanılan Shopify metafield kolonları — kısa anahtar → tam CSV başlığı.
export const METAFIELD_COLUMNS: Record<string, string> = {
  brand: "Brand (product.metafields.custom.brand)",
  dietRestrictions: "Diet Restrictions (product.metafields.custom.diet_restrictions)",
  fdaCode: "Fda Code (product.metafields.custom.fda_code)",
  fdaRegistrationCode: "FDA (product.metafields.custom.fda_registration_code)",
  turkishTitle: "Turkish Title (product.metafields.custom.turkish_title)",
  allergenInformation: "Allergen information (product.metafields.shopify.allergen-information)",
  chocolateType: "Chocolate type (product.metafields.shopify.chocolate-type)",
  color: "Color (product.metafields.shopify.color-pattern)",
  country: "Country (product.metafields.shopify.country)",
  dietaryPreferences: "Dietary preferences (product.metafields.shopify.dietary-preferences)",
  flavor: "Flavor (product.metafields.shopify.flavor)",
  flourGrainType: "Flour/Grain type (product.metafields.shopify.flour-grain-type)",
  jewelryMaterial: "Jewelry material (product.metafields.shopify.jewelry-material)",
  jewelryType: "Jewelry type (product.metafields.shopify.jewelry-type)",
  nutButterVariety: "Nut butter variety (product.metafields.shopify.nut-butter-variety)",
  productForm: "Product form (product.metafields.shopify.product-form)",
  recommendedAgeGroup: "Recommended age group (product.metafields.shopify.recommended-age-group)",
  routeOfAdministration: "Route of administration (product.metafields.shopify.route-of-administration)",
  skinCareEffect: "Skin care effect (product.metafields.shopify.skin-care-effect)",
  targetGender: "Target gender (product.metafields.shopify.target-gender)",
  toyGameMaterial: "Toy/Game material (product.metafields.shopify.toy-game-material)",
  productRatingCount: "Product rating count (product.metafields.reviews.rating_count)",
};

export interface ParsedVariant {
  sku: string;
  barcode: string | null;
  grams: number;
  price: string | null;
  costPrice: string | null;
  optionValues: string[];
  /** Variant Image kolonu doluysa bu varyanta özel görsel; boşsa genel galeriden seçilir. */
  image: string | null;
  /** CSV'deki orijinal sıra (0-based) — offerId alfabetik sıralaması Shopify'ın gerçek
   *  varyant sırasıyla uyuşmadığından, "ilk varyant" referansı bunu kullanmalı. */
  position: number;
}

export interface ParsedProduct {
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  images: string[];
  metafields: Record<string, string>;
  variants: ParsedVariant[];
}

type CsvRow = Record<string, string>;

function firstNonEmpty(rows: CsvRow[], column: string): string {
  for (const row of rows) {
    const value = row[column]?.trim();
    if (value) return value;
  }
  return "";
}

// Shopify, Excel'in barkodu bilimsel gösterime çevirmesini önlemek için sayısal alanların
// başına tek tırnak (') koyuyor — barkod/SKU olarak kullanmadan önce temizlenmeli.
function stripLeadingQuote(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}

// Bu mağazanın CSV'sinde bazı ürünlerin "Title" alanı yanlışlıkla ilk varyantın paket/beden
// bilgisini de içeriyor (örn. Title = "... Candy Drops - 1 Case - 24 Packs x 65g Each" ve
// ilk varyantın Option1 Value'su da birebir "1 Case - 24 Packs x 65g Each"). Bu durumda
// varyant adı oluştururken aynı metni bir daha eklersek isim ikileniyor — burada tespit edip
// temiz bir taban isim çıkarıyoruz.
function stripEmbeddedOptionSuffix(title: string, firstVariantOptionValues: string[]): string {
  const suffix = firstVariantOptionValues.join(" / ");
  if (!suffix || !title.toLowerCase().endsWith(suffix.toLowerCase())) {
    return title;
  }
  const stripped = title.slice(0, title.length - suffix.length).replace(/[\s\-–—]+$/, "");
  return stripped || title;
}

export function parseShopifyCsv(csvText: string): ParsedProduct[] {
  const records: CsvRow[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    bom: true,
  });

  const order: string[] = [];
  const groups = new Map<string, CsvRow[]>();
  for (const row of records) {
    const handle = row["Handle"]?.trim();
    if (!handle) continue;
    if (!groups.has(handle)) {
      groups.set(handle, []);
      order.push(handle);
    }
    groups.get(handle)!.push(row);
  }

  const products: ParsedProduct[] = [];
  for (const handle of order) {
    const rows = groups.get(handle)!;

    const metafields: Record<string, string> = {};
    for (const [key, column] of Object.entries(METAFIELD_COLUMNS)) {
      const value = firstNonEmpty(rows, column);
      if (value) metafields[key] = value;
    }

    const images = rows
      .filter((row) => row["Image Src"]?.trim())
      .sort((a, b) => Number(a["Image Position"] || 0) - Number(b["Image Position"] || 0))
      .map((row) => row["Image Src"].trim());

    const variantRows = rows.filter((row) =>
      [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]].some((v) => v?.trim())
    );

    const variants: ParsedVariant[] = variantRows.map((row, index) => {
      const optionValues = [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
        .map((v) => v?.trim())
        .filter((v): v is string => Boolean(v));
      const barcodeRaw = row["Variant Barcode"]?.trim();
      const skuRaw = row["Variant SKU"]?.trim();

      return {
        sku: skuRaw ? stripLeadingQuote(skuRaw) : `${handle}-v${index + 1}`,
        barcode: barcodeRaw ? stripLeadingQuote(barcodeRaw) : null,
        grams: Math.round(Number(row["Variant Grams"]) || 0),
        price: row["Variant Price"]?.trim() || null,
        costPrice: row["Cost per item"]?.trim() || row["Variant Price"]?.trim() || null,
        optionValues,
        image: row["Variant Image"]?.trim() || null,
        position: index,
      };
    });

    const rawTitle = firstNonEmpty(rows, "Title") || handle;
    const title = stripEmbeddedOptionSuffix(rawTitle, variants[0]?.optionValues ?? []);

    products.push({
      handle,
      title,
      descriptionHtml: firstNonEmpty(rows, "Body (HTML)"),
      vendor: firstNonEmpty(rows, "Vendor"),
      productType: firstNonEmpty(rows, "Type"),
      tags: firstNonEmpty(rows, "Tags")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      images,
      metafields,
      variants,
    });
  }

  return dedupeCollidingSkus(products);
}

// Mağazanın CSV'sinde nadiren aynı SKU birden fazla kez kullanılmış oluyor — ya FARKLI bir
// üründe (handle) ya da aynı ürünün içinde birebir tekrarlanan bir satır olarak (muhtemelen
// kaynak veri hatası, örn. iki aynı yüzük SKU'su tek üründe). offerId = SKU olduğundan bu
// durum bizim tarafta iki farklı varyantın aynı DB satırında sessizce çakışmasına (birinin
// diğerini ezmesine) yol açardı — her SKU'nun İLK görüldüğü yer olduğu gibi bırakılıyor,
// sonraki her tekrarına -2, -3... eklenerek benzersizleştiriliyor (ezici çoğunluk zaten
// tekil olduğu için okunabilirlik bozulmuyor).
function dedupeCollidingSkus(products: ParsedProduct[]): ParsedProduct[] {
  const seenCount = new Map<string, number>();
  for (const product of products) {
    for (const variant of product.variants) {
      const count = (seenCount.get(variant.sku) ?? 0) + 1;
      seenCount.set(variant.sku, count);
      if (count > 1) {
        variant.sku = `${variant.sku}-${product.handle}-${count}`;
      }
    }
  }

  return products;
}
