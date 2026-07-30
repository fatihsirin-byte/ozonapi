import { prisma } from "../../db/prisma";
import { computeSalePrice } from "../../pricing/formula";
import { translateToRussian } from "../../ai/translate";
import { createProduct, type ProductAttributeInput } from "./products.service";

export interface HandlePageItem {
  handle: string;
  title: string;
  vendor: string | null;
  type: string | null;
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

export interface HandlePageFilters {
  vendor?: string;
  type?: string;
  search?: string;
  // draft: hiçbir varyantı gönderilmemiş handle'lar. submitted: en az bir varyantı Ozon'a gönderilmiş (pending/imported/failed) handle'lar.
  status?: "draft" | "submitted";
}

async function buildStatusHandleFilter(
  status: "draft" | "submitted" | undefined,
): Promise<{ in?: string[]; notIn?: string[] } | undefined> {
  if (!status) return undefined;
  const submitted = await prisma.product.findMany({
    where: { shopifyHandle: { not: null }, status: { not: "draft" } },
    select: { shopifyHandle: true },
    distinct: ["shopifyHandle"],
  });
  const submittedHandles = submitted.map((p) => p.shopifyHandle as string);
  return status === "submitted" ? { in: submittedHandles } : { notIn: submittedHandles };
}

// `omit` — hangi filtre boyutunu (kendi facet'ini) dışarıda bırakacağımızı belirtir, ki
// "cascading" facet listeleri (örn. vendor listesi) kendi seçimiyle kısıtlanmasın.
async function buildHandleWhere(filters: HandlePageFilters, omit?: keyof HandlePageFilters) {
  const statusHandleFilter = omit === "status" ? undefined : await buildStatusHandleFilter(filters.status);

  return {
    shopifyHandle: { not: null, ...statusHandleFilter },
    ...(omit !== "vendor" && filters.vendor ? { shopifyVendor: filters.vendor } : {}),
    ...(omit !== "type" && filters.type ? { shopifyType: filters.type } : {}),
    ...(omit !== "search" && filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" as const } },
            { shopifyHandle: { contains: filters.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

// /import sayfasındaki staging listesi — Shopify Handle bazlı gruplanmış, sayfalanmış.
// Tek tek varyant (6000+ satır) yerine handle (ürün) bazında listelemek UI'ı kullanılabilir tutuyor.
export async function listDraftHandlesPage(
  page: number,
  pageSize: number,
  filters: HandlePageFilters = {},
): Promise<HandlePage> {
  const where = await buildHandleWhere(filters);

  const grouped = await prisma.product.groupBy({
    by: ["shopifyHandle"],
    where,
    _count: { _all: true },
    orderBy: { shopifyHandle: "asc" },
  });

  const total = grouped.length;
  const pageHandles = grouped.slice((page - 1) * pageSize, page * pageSize).map((g) => g.shopifyHandle as string);

  const items = await Promise.all(
    pageHandles.map(async (handle) => {
      const variants = await prisma.product.findMany({
        where: { shopifyHandle: handle },
        select: { name: true, images: true, status: true, shopifyVendor: true, shopifyType: true },
      });
      const sampleImages = (variants[0]?.images as string[] | null) ?? [];
      return {
        handle,
        title: variants[0]?.name ?? handle,
        vendor: variants[0]?.shopifyVendor ?? null,
        type: variants[0]?.shopifyType ?? null,
        variantCount: variants.length,
        submittedCount: variants.filter((v) => v.status !== "draft").length,
        sampleImage: sampleImages[0] ?? null,
      };
    })
  );

  return { items, total, page, pageSize };
}

export interface FacetOption {
  value: string;
  count: number;
}

export interface Facets {
  vendors: FacetOption[];
  types: FacetOption[];
}

// Bir alanın (vendor/type) her değeri için KAÇ FARKLI ÜRÜN (handle) eşleştiğini sayar —
// groupBy tek başına varyant satırı sayardı, bir handle'ın 4 varyantı varsa 4 sayardı.
async function countHandlesPerValue(
  field: "shopifyVendor" | "shopifyType",
  where: Record<string, unknown>,
): Promise<FacetOption[]> {
  const rows = await prisma.product.findMany({
    where: { ...where, [field]: { not: null } },
    select: { shopifyHandle: true, [field]: true },
    distinct: [field, "shopifyHandle"],
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = (row as Record<string, unknown>)[field] as string;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

// Filtre dropdown'ları için — "cascading": her facet, DİĞER aktif filtrelerle kısıtlanmış
// halde hesaplanır ama kendi boyutuyla değil (yoksa örn. bir vendor seçilince o filtre
// kendi kendini listede tek seçenek bırakırdı).
export async function getFacets(filters: HandlePageFilters = {}): Promise<Facets> {
  const [vendorWhere, typeWhere] = await Promise.all([
    buildHandleWhere(filters, "vendor"),
    buildHandleWhere(filters, "type"),
  ]);

  const [vendors, types] = await Promise.all([
    countHandlesPerValue("shopifyVendor", vendorWhere),
    countHandlesPerValue("shopifyType", typeWhere),
  ]);

  return { vendors, types };
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
    select: {
      id: true,
      offerId: true,
      name: true,
      shopifyHandle: true,
      shopifyVendor: true,
      images: true,
      originalImages: true,
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
