import { prisma } from "../../db/prisma";
import type { Prisma, Product, ToptantrListing } from "@prisma/client";
import { env } from "../../config/env";
import {
  createProduct,
  updateProduct,
  findProductByBarcode,
  updateCombinations,
  type ToptantrProductPayload,
} from "../../toptantr/client";
import { rankVariants, describeVariants, computeTierStock, hasPriceAnomaly, isSingleUnitOnlyHandle, isTierSendable, barcodeOf, type VariantTierView } from "../../toptantr/quantity";
import { usdToTl } from "../../toptantr/pricing";
import { translateForToptantr } from "../../toptantr/translate";
import { getCachedMapping, setCachedMapping } from "../../toptantr/mapping";
import { parseManualTiers, validateManualTiers, buildManualRanked, type ManualTier } from "../../toptantr/manualTiers";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Barkod, ürün toptantr'a POST edildikten hemen sonra ARAMADA çıkmayabiliyor — indekslenmesi
// birkaç dakika sürebiliyor (VPS'teki orijinal projede ampirik olarak doğrulandı). ~1 dakika
// boyunca artan aralıklarla tekrar dener, hâlâ bulunamazsa "pending" (hata değil) sayılır.
async function findProductByBarcodeWithRetry(barcode: string, attempts = 7, delayMs = 8000) {
  for (let i = 0; i < attempts; i++) {
    const found = await findProductByBarcode(barcode);
    if (found) return found;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

export interface ToptantrPreview {
  listing: ToptantrListing | null;
  variants: VariantTierView[];
  priceAnomaly: boolean;
  isSingleUnitOnly: boolean;
  suggestedMapping: { categoryGuid: string | null; brandGuid: string | null } | null;
  manualTiers: ManualTier[];
}

export async function getToptantrPreview(handle: string): Promise<ToptantrPreview> {
  const products = await prisma.product.findMany({ where: { shopifyHandle: handle }, orderBy: { variantPosition: "asc" } });
  if (products.length === 0) throw new Error("Handle bulunamadı");

  const listing = await prisma.toptantrListing.findUnique({ where: { shopifyHandle: handle } });
  const ranked = rankVariants(products);
  const stockBySku = computeTierStock(ranked);
  const variants = describeVariants(ranked, stockBySku);
  const suggestedMapping = await getCachedMapping(products[0].shopifyVendor, products[0].shopifyType);

  return {
    listing,
    variants,
    priceAnomaly: hasPriceAnomaly(variants),
    isSingleUnitOnly: isSingleUnitOnlyHandle(products),
    suggestedMapping,
    manualTiers: parseManualTiers(listing?.manualTiers),
  };
}

// Elle kademeleri kaydeder (boş liste = elle kademeyi kaldır, otomatik düzene dön). Listing yoksa
// taslak olarak oluşturulur.
export async function saveManualTiers(handle: string, input: unknown): Promise<ManualTier[]> {
  const exists = await prisma.product.count({ where: { shopifyHandle: handle } });
  if (exists === 0) throw new Error("Handle bulunamadı");
  const tiers = validateManualTiers(input);
  await prisma.toptantrListing.upsert({
    where: { shopifyHandle: handle },
    create: { shopifyHandle: handle, manualTiers: tiers as unknown as Prisma.InputJsonValue },
    update: { manualTiers: tiers as unknown as Prisma.InputJsonValue },
  });
  return tiers;
}

// Gemini ile toptantr için özgün Türkçe başlık/açıklama üretir ve listing'e kaydeder (henüz
// toptantr'a GÖNDERMEZ — kullanıcı önce görüp düzenler, bkz. pushToptantrText).
export async function generateToptantrText(handle: string) {
  const primary = await prisma.product.findFirst({ where: { shopifyHandle: handle }, orderBy: { variantPosition: "asc" } });
  if (!primary) throw new Error("Handle bulunamadı");
  const translated = await translateForToptantr(primary.name, primary.descriptionHtml ?? "");
  await prisma.toptantrListing.upsert({
    where: { shopifyHandle: handle },
    create: { shopifyHandle: handle, translatedTitle: translated.title, shortDescription: translated.shortDescription, fullDescription: translated.fullDescription },
    update: { translatedTitle: translated.title, shortDescription: translated.shortDescription, fullDescription: translated.fullDescription },
  });
  return translated;
}

// Kullanıcının düzenlediği metni kaydeder; push=true ve ürün zaten toptantr'da ise güncellenmiş
// metni toptantr'a da gönderir.
export async function saveToptantrText(handle: string, text: { title: string; shortDescription: string; fullDescription: string }, push: boolean) {
  const title = text.title.trim();
  if (!title) throw new Error("Başlık boş olamaz");
  if (text.shortDescription.length > 500) throw new Error("Kısa açıklama en fazla 500 karakter olmalı");
  if (text.fullDescription.length > 4000) throw new Error("Uzun açıklama en fazla 4000 karakter olmalı");
  const listing = await prisma.toptantrListing.upsert({
    where: { shopifyHandle: handle },
    create: { shopifyHandle: handle, translatedTitle: title, shortDescription: text.shortDescription, fullDescription: text.fullDescription },
    update: { translatedTitle: title, shortDescription: text.shortDescription, fullDescription: text.fullDescription },
  });
  if (push) {
    if (listing.status !== "success" || !listing.toptantrProductId) throw new Error("Ürün henüz toptantr'a bağlı değil — metin kaydedildi, bağlayınca gönderilecek");
    await updateProduct(listing.toptantrProductId, { title, shortDescription: text.shortDescription, fullDescription: text.fullDescription });
  }
}

function buildPayload(params: {
  products: Product[];
  translated: { title: string; shortDescription: string; fullDescription: string };
  categoryGuid: string;
  brandGuid: string | null;
  sendableRanked: ReturnType<typeof rankVariants>;
  barcode: string;
}): ToptantrProductPayload {
  const primary = params.sendableRanked[0].product;
  const images = (primary.images as string[] | null) ?? [];
  return {
    title: params.translated.title,
    shortDescription: params.translated.shortDescription,
    fullDescription: params.translated.fullDescription,
    barcode: params.barcode,
    categories: [{ guid: params.categoryGuid }],
    brands: params.brandGuid ? [{ guid: params.brandGuid }] : [],
    taxCategory: env.toptantrDefaultTaxCategory,
    isTaxExempt: false,
    productCost: usdToTl(primary.costPrice),
    weight: primary.weightGrams ? Math.round((primary.weightGrams / 1000) * 1000) / 1000 : 0.1,
    // VPS'teki orijinal projede bu üçü hep sabit 10/10/10'du (Shopify CSV'sinde boyut verisi hiç
    // yoktu) — burada Ozon için zaten girilen gerçek ölçüler (widthCm/heightCm/depthCm) varsa
    // onlar kullanılıyor, yoksa aynı 10 cm varsayılanına düşülüyor (2026-09-26, code review bulgusu).
    length: primary.depthCm ?? 10,
    width: primary.widthCm ?? 10,
    height: primary.heightCm ?? 10,
    images: images.map((url) => ({ url })),
    productSpecificationOptions: [],
    productAttributeCombinations: params.sendableRanked.map(({ product, quantity, attributeId, attributeName }) => ({
      barcode: barcodeOf(product) || "",
      itemPerPackage: quantity,
      purchaseableLimit: 1000,
      attributes: [{ id: attributeId, name: attributeName }],
    })),
  };
}

// toptantr'a gönderilecek kombinasyonların stok/fiyatını, o an bulunan (barkodla aranan) ürünün
// KENDİ döndürdüğü kombinasyon id'leriyle eşleştirip PUT /combinations ile günceller — bkz.
// src/toptantr/client.ts'teki ToptantrCombinationStockUpdate yorumu (createProduct'takinden
// FARKLI bir şekil).
async function pushStockAndPrice(
  barcode: string,
  sendableRanked: ReturnType<typeof rankVariants>,
  stockBySku: Map<string, number>,
) {
  const found = await findProductByBarcodeWithRetry(barcode);
  if (!found) {
    return { toptantrProductId: null as string | null, combinationsUpdated: 0, combinationsPending: true };
  }

  const returned = found.productAttributeCombinations ?? [];
  const updates = [];
  for (const ranked of sendableRanked) {
    const match = returned.find((c) => (c.attributes ?? []).some((a) => a.id === ranked.attributeId));
    if (!match) continue;
    updates.push({
      id: match.id,
      quantity: stockBySku.get(ranked.product.offerId) ?? 0,
      taxCategory: env.toptantrDefaultTaxCategory,
      sellingPrice: usdToTl(ranked.product.costPrice),
    });
  }
  if (updates.length > 0) {
    await updateCombinations(updates);
  }
  return { toptantrProductId: found.id, combinationsUpdated: updates.length, combinationsPending: false };
}

// Elle kademe varsa onlar (taban = handle'ın ilk varyantı), yoksa otomatik sıralama + onaylı varyantlar.
function resolveTiers(products: Product[], manualTiers: ManualTier[]) {
  if (manualTiers.length > 0) {
    const { ranked, stockBySku } = buildManualRanked(products[0], manualTiers);
    return { ranked, sendableRanked: ranked, stockBySku };
  }
  const ranked = rankVariants(products);
  const sendableRanked = ranked.filter(
    (r) => products.find((p) => p.id === r.product.id)?.toptantrApproved && isTierSendable(r.attributeName, r.product),
  );
  return { ranked, sendableRanked, stockBySku: computeTierStock(ranked) };
}

export interface ConnectHandleInput {
  handle: string;
  categoryGuid: string;
  brandGuid: string | null;
}

// Bir handle'ı (Ozon'daki submitHandleToOzon'un toptantr karşılığı) ilk kez toptantr'a bağlar —
// sadece kullanıcının UI'dan (checkbox, ToptantrPanel.tsx) toptantrApproved=true işaretlediği ve
// "sendable" (bkz. isTierSendable) varyantlar gönderilir. Halihazırda bağlıysa (ToptantrListing
// zaten success ise) tekrar çağırmak GÜVENLİ ama gereksiz — bkz. refreshToptantrHandle.
export async function connectHandleToToptantr(input: ConnectHandleInput): Promise<ToptantrListing> {
  const products = await prisma.product.findMany({ where: { shopifyHandle: input.handle }, orderBy: { variantPosition: "asc" } });
  if (products.length === 0) throw new Error("Handle bulunamadı");
  const priorListing = await prisma.toptantrListing.findUnique({ where: { shopifyHandle: input.handle } });
  const manualTiers = parseManualTiers(priorListing?.manualTiers);
  if (manualTiers.length === 0 && isSingleUnitOnlyHandle(products)) {
    throw new Error("Bu ürün tek parçalık (tekli) bir perakende ürünü — elle kademe (Paket/Koli) girmeden toptantr'a gönderilemez");
  }

  const { ranked, sendableRanked, stockBySku } = resolveTiers(products, manualTiers);
  if (sendableRanked.length === 0) {
    throw new Error("Gönderilecek onaylı (toptantrApproved) varyant yok — önce en az bir varyantı onaylayın");
  }

  const existingListing = await prisma.toptantrListing.upsert({
    where: { shopifyHandle: input.handle },
    create: { shopifyHandle: input.handle, categoryGuid: input.categoryGuid, brandGuid: input.brandGuid, status: "pending" },
    update: { categoryGuid: input.categoryGuid, brandGuid: input.brandGuid, status: "pending", lastError: null },
  });

  const primary = products[0];
  let translated = existingListing.translatedTitle
    ? {
        title: existingListing.translatedTitle,
        shortDescription: existingListing.shortDescription ?? "",
        fullDescription: existingListing.fullDescription ?? "",
      }
    : await translateForToptantr(primary.name, primary.descriptionHtml ?? "");

  if (!existingListing.translatedTitle) {
    await prisma.toptantrListing.update({
      where: { shopifyHandle: input.handle },
      data: { translatedTitle: translated.title, shortDescription: translated.shortDescription, fullDescription: translated.fullDescription },
    });
  }

  await setCachedMapping(primary.shopifyVendor, primary.shopifyType, { categoryGuid: input.categoryGuid, brandGuid: input.brandGuid });

  // Kalıcı eşleşme: listing'de toptantr'ın kayıtlı barkodu varsa o, yoksa Shopify/SKU barkodu —
  // ve ilk kez kullanılan barkod listing'e yazılır ki sonradan değişse de eşleşme bozulmasın.
  const barcode = existingListing.toptantrBarcode ?? barcodeOf(sendableRanked[0].product);
  if (!existingListing.toptantrBarcode) {
    await prisma.toptantrListing.update({ where: { shopifyHandle: input.handle }, data: { toptantrBarcode: barcode } });
  }
  const payload = buildPayload({ products, translated, categoryGuid: input.categoryGuid, brandGuid: input.brandGuid, sendableRanked, barcode });

  try {
    let toptantrProductId: string | null = null;
    try {
      const created = await createProduct(payload);
      toptantrProductId = (created.id as string | undefined) ?? null;
    } catch (createErr) {
      // toptantr aynı barkodla ikinci bir /products/new isteğini reddediyor — bu, ürün DAHA ÖNCE
      // (ör. bu panel dışında, veya state kaybolmuşsa) zaten oluşturulmuş demektir; barkodla bulup
      // PUT (update) ile devam ediyoruz (VPS'teki orijinal pipeline.js'teki self-heal ile aynı).
      const message = createErr instanceof Error ? createErr.message : String(createErr);
      const isDuplicateBarcode = /barkod|barcode/i.test(message) && /kullanamaz|zaten|tanımlı|başka/i.test(message);
      if (!isDuplicateBarcode) throw createErr;

      const existingProduct = await findProductByBarcodeWithRetry(barcode);
      if (!existingProduct) throw createErr;
      await updateProduct(existingProduct.id, payload);
      toptantrProductId = existingProduct.id;
    }

    const stockResult = await pushStockAndPrice(barcode, sendableRanked, stockBySku);

    const updated = await prisma.toptantrListing.update({
      where: { shopifyHandle: input.handle },
      data: {
        toptantrProductId: stockResult.toptantrProductId ?? toptantrProductId,
        status: "success",
        lastError: stockResult.combinationsPending
          ? "Ürün oluşturuldu ama toptantr tarafında henüz indekslenmedi — stok/fiyat bir sonraki senkronda gönderilecek"
          : null,
        lastSyncedAt: new Date(),
      },
    });
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return prisma.toptantrListing.update({ where: { shopifyHandle: input.handle }, data: { status: "failed", lastError: message } });
  }
}

// Zaten bağlı (success) bir handle'ın stok/fiyatını günceller — YENİDEN OLUŞTURMAZ, Gemini
// çeviri/kategori seçimine dokunmaz (bkz. VPS'teki orijinal refreshExistingProduct yorumu: "a
// product already sent for real must NEVER be re-created or re-translated").
export async function refreshToptantrHandle(handle: string): Promise<ToptantrListing> {
  const listing = await prisma.toptantrListing.findUnique({ where: { shopifyHandle: handle } });
  if (!listing || listing.status !== "success") {
    throw new Error("Bu handle henüz toptantr'a bağlanmamış — önce Bağla ile ilk gönderimi yapın");
  }

  const products = await prisma.product.findMany({ where: { shopifyHandle: handle }, orderBy: { variantPosition: "asc" } });
  const { sendableRanked, stockBySku } = resolveTiers(products, parseManualTiers(listing.manualTiers));
  if (sendableRanked.length === 0) {
    throw new Error("Gönderilecek onaylı varyant yok");
  }

  const barcode = listing.toptantrBarcode ?? barcodeOf(sendableRanked[0].product);
  try {
    const result = await pushStockAndPrice(barcode, sendableRanked, stockBySku);
    return prisma.toptantrListing.update({
      where: { shopifyHandle: handle },
      data: {
        lastSyncedAt: new Date(),
        lastError: result.combinationsPending ? "toptantr tarafında henüz indekslenmedi, tekrar denenecek" : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return prisma.toptantrListing.update({ where: { shopifyHandle: handle }, data: { lastError: message } });
  }
}
