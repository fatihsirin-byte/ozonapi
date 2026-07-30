import { prisma } from "../db/prisma";
import { computeSalePrice } from "../pricing/formula";
import { parseShopifyCsv, type ParsedProduct } from "./shopify-csv";

export interface ImportSummary {
  handles: number;
  variants: number;
}

// Tek seferde binlerce satırı tek transaction'da upsert etmemek için parçalara bölüyoruz
// (products_export_1.csv ~1800 handle / ~6200 varyant içeriyor).
const CHUNK_SIZE = 200;

export async function importShopifyCsvText(csvText: string): Promise<ImportSummary> {
  const products = parseShopifyCsv(csvText);
  return upsertParsedProducts(products);
}

export async function upsertParsedProducts(products: ParsedProduct[]): Promise<ImportSummary> {
  const rows = products.flatMap((product) =>
    product.variants.map((variant) => {
      const name =
        product.variants.length > 1 ? `${product.title} - ${variant.optionValues.join(" / ")}` : product.title;
      const images = variant.image
        ? [variant.image, ...product.images.filter((src) => src !== variant.image)]
        : product.images;
      const price = variant.costPrice ? computeSalePrice(variant.costPrice, variant.grams || null) : "";

      return {
        offerId: variant.sku,
        name,
        costPrice: variant.costPrice,
        price: price || variant.price || "0",
        weightGrams: variant.grams || null,
        images,
        originalImages: product.images,
        shopifyHandle: product.handle,
        shopifyVariantId: variant.sku,
        shopifyMetafields: product.metafields,
        descriptionHtml: product.descriptionHtml,
      };
    })
  );

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((row) =>
        prisma.product.upsert({
          where: { offerId: row.offerId },
          create: {
            offerId: row.offerId,
            name: row.name,
            price: row.price,
            costPrice: row.costPrice,
            weightGrams: row.weightGrams,
            images: row.images,
            originalImages: row.originalImages,
            shopifyHandle: row.shopifyHandle,
            shopifyVariantId: row.shopifyVariantId,
            shopifyMetafields: row.shopifyMetafields,
            descriptionHtml: row.descriptionHtml,
            status: "draft",
          },
          // CSV yeniden çalıştırıldığında images/status'a kasıtlı dokunmuyoruz — kullanıcı
          // görselleri değiştirmiş veya gönderime hazırlamış olabilir, üzerine yazmamalı.
          update: {
            name: row.name,
            costPrice: row.costPrice,
            weightGrams: row.weightGrams,
            originalImages: row.originalImages,
            shopifyHandle: row.shopifyHandle,
            shopifyVariantId: row.shopifyVariantId,
            shopifyMetafields: row.shopifyMetafields,
            descriptionHtml: row.descriptionHtml,
          },
        })
      )
    );
  }

  return { handles: products.length, variants: rows.length };
}
