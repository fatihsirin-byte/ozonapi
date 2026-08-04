import fs from "fs";
import { prisma } from "../db/prisma";
import { parseShopifyCsv, type ParsedProduct, type ParsedVariant } from "../import/shopify-csv";
import { extractPackQuantity, isBulkPackVariant } from "../import/pack-quantity";
import { computeSalePrice } from "../pricing/formula";

const COMMIT = process.argv.includes("--commit");

function packDimensionIndex(optionValues: string[]): number {
  for (let i = optionValues.length - 1; i >= 0; i--) {
    if (isBulkPackVariant(optionValues[i]) || /piece|pack|bar|\d+\s*(g|kg|ml)\b/i.test(optionValues[i])) {
      return i;
    }
  }
  return optionValues.length - 1;
}

function otherDimensions(optionValues: string[], skipIndex: number): string {
  return optionValues.filter((_, i) => i !== skipIndex).join(" / ");
}

interface BaseCandidate {
  offerId: string;
  costPrice: string | null;
  weightGrams: number | null;
  optionValues: string[];
  // true ise bu taban varyant şu an Product tablosunda yok (o da silinmiş/hiç işlenmemiş) —
  // bulk varyantı ona bağlamadan önce kendisini de restore etmemiz gerekiyor.
  needsRestore: boolean;
  images: string[];
  variantImage: string | null;
  position: number;
}

function findBase(target: ParsedVariant, candidates: BaseCandidate[]): BaseCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const targetDim = packDimensionIndex(target.optionValues);
  const targetOther = otherDimensions(target.optionValues, targetDim);
  const exact = candidates.find((c) => {
    const dim = packDimensionIndex(c.optionValues);
    return otherDimensions(c.optionValues, dim) === targetOther;
  });
  return exact ?? candidates[0];
}

async function main() {
  const csv = fs.readFileSync("products_export_1.csv", "utf-8");
  const products: ParsedProduct[] = parseShopifyCsv(csv);

  const excluded = await prisma.excludedOfferId.findMany({ select: { offerId: true } });
  const excludedSet = new Set(excluded.map((e) => e.offerId));

  const handles = products.map((p) => p.handle);
  const existingProducts = await prisma.product.findMany({
    where: { shopifyHandle: { in: handles } },
    select: { offerId: true, shopifyHandle: true, costPrice: true, weightGrams: true, name: true },
  });
  const existingByHandle = new Map<string, typeof existingProducts>();
  for (const p of existingProducts) {
    const list = existingByHandle.get(p.shopifyHandle!) ?? [];
    list.push(p);
    existingByHandle.set(p.shopifyHandle!, list);
  }
  const existingOfferIdSet = new Set(existingProducts.map((p) => p.offerId));

  let restored = 0;
  let skippedNoQty = 0;
  let skippedNoBase = 0;
  let baseRestoredCount = 0;
  const queuedBaseRestores = new Set<string>();
  const noQtySamples: string[] = [];
  const noBaseSamples: string[] = [];
  const restoredRows: Array<{
    offerId: string;
    name: string;
    costPrice: string;
    weightGrams: number;
    unitsInPack: number;
    packBaseOfferId: string | null;
    price: string;
    shopifyHandle: string;
    images: string[];
    originalImages: string[];
    shopifyVendor: string | null;
    shopifyType: string | null;
    shopifyMetafields: Record<string, string>;
    descriptionHtml: string;
    variantPosition: number;
  }> = [];

  for (const product of products) {
    const existingHere = existingByHandle.get(product.handle) ?? [];
    const baseCandidates: BaseCandidate[] = product.variants
      .filter((v) => !isBulkPackVariant(v.optionValues.join(" / ")))
      .map((v) => {
        const existing = existingHere.find((p) => p.offerId === v.sku);
        const costPrice = existing?.costPrice ?? v.costPrice ?? null;
        const weightGrams = existing?.weightGrams ?? (v.grams || null);
        const images = v.image ? [v.image, ...product.images.filter((src) => src !== v.image)] : product.images;
        return {
          offerId: v.sku,
          costPrice,
          weightGrams,
          optionValues: v.optionValues,
          needsRestore: !existingOfferIdSet.has(v.sku),
          images,
          variantImage: v.image,
          position: v.position,
        };
      })
      .filter((c) => c.costPrice);

    for (const variant of product.variants) {
      const opt = variant.optionValues.join(" / ");
      if (!isBulkPackVariant(opt)) continue;
      if (!excludedSet.has(variant.sku)) continue; // zaten aktif veya hiç silinmemiş

      const qty = extractPackQuantity(opt);
      if (!qty) {
        skippedNoQty++;
        if (noQtySamples.length < 40) noQtySamples.push(`${product.handle}: ${opt}`);
        continue;
      }

      const base = findBase(variant, baseCandidates);
      if (!base || !base.costPrice) {
        skippedNoBase++;
        if (noBaseSamples.length < 40) noBaseSamples.push(`${product.handle}: ${opt}`);
        continue;
      }

      if (base.needsRestore && !queuedBaseRestores.has(base.offerId)) {
        queuedBaseRestores.add(base.offerId);
        const basePrice = computeSalePrice(base.costPrice, base.weightGrams) || "0";
        restoredRows.push({
          offerId: base.offerId,
          name: `${product.title} - ${base.optionValues.join(" / ")}`,
          costPrice: base.costPrice,
          weightGrams: base.weightGrams ?? 0,
          unitsInPack: 1,
          packBaseOfferId: null,
          price: basePrice,
          shopifyHandle: product.handle,
          images: base.images,
          originalImages: product.images,
          shopifyVendor: product.vendor || null,
          shopifyType: product.productType || null,
          shopifyMetafields: product.metafields,
          descriptionHtml: product.descriptionHtml,
          variantPosition: base.position,
        });
        baseRestoredCount++;
      }

      const baseCost = Number(base.costPrice);
      const cascadeCost = baseCost * qty;
      const csvCost = variant.costPrice ? Number(variant.costPrice) : null;
      const costPrice = (
        csvCost && Math.abs(csvCost - cascadeCost) / cascadeCost < 0.2 ? csvCost : cascadeCost
      ).toFixed(2);

      const baseWeight = base.weightGrams;
      const cascadeWeight = baseWeight ? baseWeight * qty : null;
      const csvWeight = variant.grams || null;
      const weightGrams =
        csvWeight && cascadeWeight && Math.abs(csvWeight - cascadeWeight) / cascadeWeight < 0.2
          ? csvWeight
          : cascadeWeight ?? csvWeight ?? 0;

      const price = computeSalePrice(costPrice, weightGrams) || "0";
      const name = `${product.title} - ${variant.optionValues.join(" / ")}`;
      const images = variant.image
        ? [variant.image, ...product.images.filter((src) => src !== variant.image)]
        : product.images;

      restoredRows.push({
        offerId: variant.sku,
        name,
        costPrice,
        weightGrams,
        unitsInPack: qty,
        packBaseOfferId: base.offerId,
        price,
        shopifyHandle: product.handle,
        images,
        originalImages: product.images,
        shopifyVendor: product.vendor || null,
        shopifyType: product.productType || null,
        shopifyMetafields: product.metafields,
        descriptionHtml: product.descriptionHtml,
        variantPosition: variant.position,
      });
      restored++;
    }
  }

  console.log(
    `Restore edilecek (bulk): ${restored}, ek olarak restore edilen taban: ${baseRestoredCount}, adet çıkarılamadı: ${skippedNoQty}, taban varyant bulunamadı: ${skippedNoBase}`,
  );
  console.log("\n--- Örnek 15 satır ---");
  for (const r of restoredRows.slice(0, 15)) {
    console.log(
      `${r.offerId} | ${r.name.slice(0, 70)} | adet=${r.unitsInPack} | alış=$${r.costPrice} | ağırlık=${r.weightGrams}g | taban=${r.packBaseOfferId}`,
    );
  }
  console.log("\n--- Adet çıkarılamayanlar (ilk 40) ---");
  noQtySamples.forEach((s) => console.log(" ", s));
  console.log("\n--- Taban bulunamayanlar (ilk 40) ---");
  noBaseSamples.forEach((s) => console.log(" ", s));

  if (!COMMIT) {
    console.log("\nDRY RUN — DB'ye yazılmadı. --commit ile gerçek çalıştır.");
    return;
  }

  console.log("\nCOMMIT modunda, yazılıyor...");
  const CHUNK = 100;
  for (let i = 0; i < restoredRows.length; i += CHUNK) {
    const chunk = restoredRows.slice(i, i + CHUNK);
    await prisma.excludedOfferId.deleteMany({ where: { offerId: { in: chunk.map((r) => r.offerId) } } });
    await Promise.all(
      chunk.map((r) =>
        prisma.product.create({
          data: {
            offerId: r.offerId,
            name: r.name,
            price: r.price,
            costPrice: r.costPrice,
            weightGrams: r.weightGrams,
            unitsInPack: r.unitsInPack,
            packBaseOfferId: r.packBaseOfferId,
            images: r.images,
            originalImages: r.originalImages,
            shopifyHandle: r.shopifyHandle,
            shopifyVariantId: r.offerId,
            shopifyVendor: r.shopifyVendor,
            shopifyType: r.shopifyType,
            shopifyMetafields: r.shopifyMetafields,
            descriptionHtml: r.descriptionHtml,
            variantPosition: r.variantPosition,
            status: "draft",
          },
        }),
      ),
    );
    console.log(`${Math.min(i + CHUNK, restoredRows.length)}/${restoredRows.length}`);
  }
  console.log("Bitti.");
}

main().finally(() => prisma.$disconnect());
