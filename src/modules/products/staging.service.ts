import { prisma } from "../../db/prisma";
import { computeSalePrice } from "../../pricing/formula";
import { translateToRussian } from "../../ai/translate";
import { createProduct, type ProductAttributeInput } from "./products.service";

export interface HandlePageItem {
  handle: string;
  title: string;
  variantCount: number;
  submittedCount: number;
  sampleImage: string | null;
}

export interface HandlePage {
  items: HandlePageItem[];
  total: number;
  page: number;
  pageSize: number;
}

// /import sayfasındaki staging listesi — Shopify Handle bazlı gruplanmış, sayfalanmış.
// Tek tek varyant (6000+ satır) yerine handle (ürün) bazında listelemek UI'ı kullanılabilir tutuyor.
export async function listDraftHandlesPage(page: number, pageSize: number): Promise<HandlePage> {
  const grouped = await prisma.product.groupBy({
    by: ["shopifyHandle"],
    where: { shopifyHandle: { not: null } },
    _count: { _all: true },
    orderBy: { shopifyHandle: "asc" },
  });

  const total = grouped.length;
  const pageHandles = grouped.slice((page - 1) * pageSize, page * pageSize).map((g) => g.shopifyHandle as string);

  const items = await Promise.all(
    pageHandles.map(async (handle) => {
      const variants = await prisma.product.findMany({
        where: { shopifyHandle: handle },
        select: { name: true, images: true, status: true },
      });
      const sampleImages = (variants[0]?.images as string[] | null) ?? [];
      return {
        handle,
        title: variants[0]?.name ?? handle,
        variantCount: variants.length,
        submittedCount: variants.filter((v) => v.status !== "draft").length,
        sampleImage: sampleImages[0] ?? null,
      };
    })
  );

  return { items, total, page, pageSize };
}

export async function getHandleGroup(handle: string) {
  return prisma.product.findMany({
    where: { shopifyHandle: handle },
    include: { modelGroup: { include: { products: true } } },
    orderBy: { offerId: "asc" },
  });
}

// Görseller handle içindeki tüm varyantlarda paylaşılıyor (Shopify'da da öyle) — tek seferde hepsine yazılır.
export async function updateDraftImages(handle: string, images: string[]) {
  await prisma.product.updateMany({ where: { shopifyHandle: handle, status: "draft" }, data: { images } });
}

export async function updateDraftVariant(
  offerId: string,
  data: { weightGrams?: number; costPrice?: string }
) {
  const existing = await prisma.product.findUnique({ where: { offerId } });
  const weightGrams = data.weightGrams ?? existing?.weightGrams ?? undefined;
  const costPrice = data.costPrice ?? existing?.costPrice ?? undefined;
  const price = costPrice ? computeSalePrice(costPrice, weightGrams) : existing?.price;

  return prisma.product.update({
    where: { offerId },
    data: { ...data, price: price || existing?.price },
  });
}

export async function deleteHandles(handles: string[]) {
  const result = await prisma.product.deleteMany({ where: { shopifyHandle: { in: handles }, status: "draft" } });
  return result.count;
}

export async function searchStagedProducts(query: string, excludeHandle?: string) {
  return prisma.product.findMany({
    where: {
      status: { in: ["draft", "ready"] },
      shopifyHandle: excludeHandle ? { not: excludeHandle } : undefined,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { shopifyHandle: { contains: query, mode: "insensitive" } },
        { offerId: { contains: query, mode: "insensitive" } },
      ],
    },
    take: 20,
    orderBy: { name: "asc" },
  });
}

// Bir handle'ın tüm varyantlarını, hedef ürünün (varsa) mevcut ModelGroup'una katar; yoksa
// ikisi için de yeni bir grup açar. Grup adı, Ozon'a giderken 9048 attribute değeri olarak kullanılır.
export async function linkHandleToModelGroup(sourceHandle: string, targetOfferId: string) {
  const target = await prisma.product.findUnique({ where: { offerId: targetOfferId }, include: { modelGroup: true } });
  if (!target) throw new Error("Hedef ürün bulunamadı");

  const groupId =
    target.modelGroupId ??
    (
      await prisma.modelGroup.create({ data: { name: target.shopifyHandle ?? target.offerId } })
    ).id;

  if (!target.modelGroupId) {
    await prisma.product.update({ where: { id: target.id }, data: { modelGroupId: groupId } });
  }

  await prisma.product.updateMany({ where: { shopifyHandle: sourceHandle }, data: { modelGroupId: groupId } });

  return prisma.modelGroup.findUnique({ where: { id: groupId }, include: { products: true } });
}

export async function unlinkHandleFromModelGroup(handle: string) {
  await prisma.product.updateMany({ where: { shopifyHandle: handle }, data: { modelGroupId: null } });
}

// Gemini çevirisini bir kez yapıp handle'daki tüm varyantlara cache'ler — aynı ürün için
// tekrar tekrar token harcamamak için (kullanıcı isterse elle düzeltebilir).
export async function translateHandle(handle: string) {
  const first = await prisma.product.findFirst({ where: { shopifyHandle: handle } });
  if (!first) throw new Error("Handle bulunamadı");

  const { nameRu, descriptionRu } = await translateToRussian(first.name, first.descriptionHtml ?? "");
  await prisma.product.updateMany({ where: { shopifyHandle: handle }, data: { nameRu, descriptionRu } });
  return { nameRu, descriptionRu };
}

export interface SubmitHandleInput {
  handle: string;
  descriptionCategoryId: number;
  typeId: number;
  attributes: ProductAttributeInput[];
  nameOverrideByOfferId?: Record<string, string>;
}

// Bir handle'ın tüm varyantlarını (aynı kategori/attribute seçimiyle) Ozon'a gönderir.
// Model grubu varsa hepsine aynı 9048 değeri yazılır, ki Ozon bunları tek kartta göstersin.
export async function submitHandleToOzon(input: SubmitHandleInput) {
  const variants = await prisma.product.findMany({
    where: { shopifyHandle: input.handle },
    include: { modelGroup: true },
  });
  if (variants.length === 0) throw new Error("Bu handle için varyant bulunamadı");

  const results: { offerId: string; taskId?: string; error?: string }[] = [];

  for (const variant of variants) {
    const modelNameOverride = variant.modelGroup?.name ?? undefined;
    try {
      const { taskId } = await createProduct({
        offerId: variant.offerId,
        name: input.nameOverrideByOfferId?.[variant.offerId] ?? variant.name,
        costPrice: variant.costPrice ?? "0",
        images: Array.isArray(variant.images) ? (variant.images as string[]) : [],
        descriptionCategoryId: input.descriptionCategoryId,
        typeId: input.typeId,
        weightGrams: variant.weightGrams ?? 100,
        widthCm: variant.widthCm ?? 10,
        heightCm: variant.heightCm ?? 10,
        depthCm: variant.depthCm ?? 10,
        attributes: input.attributes,
        modelNameOverride,
      });
      results.push({ offerId: variant.offerId, taskId: taskId ? String(taskId) : undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bilinmeyen hata";
      results.push({ offerId: variant.offerId, error: message });
    }
  }

  return results;
}
