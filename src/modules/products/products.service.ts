import { prisma } from "../../db/prisma";
import { importProducts, getImportStatus, updatePrices } from "../../ozon/products";
import { computeSalePrice } from "../../pricing/formula";

// Ozon hesabının sözleşme para birimi USD — RUB gönderilirse ürün sessizce "pending" kalıp
// sonunda currency_differs_from_contract hatasıyla düşüyor (Faz 1'de keşfedildi).
const CURRENCY_CODE = "USD";

// Ozon'un varyant gruplama alanı — product.service.ts ve wizard'da aynı sabit kullanılıyor.
const MODEL_NAME_ATTRIBUTE_ID = 9048;

export interface ProductAttributeInput {
  id: number;
  value?: string;
  dictionaryValueId?: number;
}

export interface CreateProductInput {
  offerId: string;
  name: string;
  costPrice: string;
  images: string[];
  descriptionCategoryId: number;
  typeId: number;
  weightGrams: number;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  attributes: ProductAttributeInput[];
}

export async function createProduct(input: CreateProductInput) {
  const price = computeSalePrice(input.costPrice);

  await prisma.product.upsert({
    where: { offerId: input.offerId },
    create: {
      offerId: input.offerId,
      name: input.name,
      price,
      costPrice: input.costPrice,
      currencyCode: CURRENCY_CODE,
      weightGrams: input.weightGrams,
      widthCm: input.widthCm,
      heightCm: input.heightCm,
      depthCm: input.depthCm,
      descriptionCategoryId: input.descriptionCategoryId,
      typeId: input.typeId,
      images: input.images,
      status: "pending",
      lastError: null,
    },
    update: {
      name: input.name,
      price,
      costPrice: input.costPrice,
      currencyCode: CURRENCY_CODE,
      weightGrams: input.weightGrams,
      widthCm: input.widthCm,
      heightCm: input.heightCm,
      depthCm: input.depthCm,
      descriptionCategoryId: input.descriptionCategoryId,
      typeId: input.typeId,
      images: input.images,
      status: "pending",
      lastError: null,
    },
  });

  const { result } = await importProducts([
    {
      offer_id: input.offerId,
      name: input.name,
      price,
      currency_code: CURRENCY_CODE,
      category_id: input.descriptionCategoryId,
      description_category_id: input.descriptionCategoryId,
      type_id: input.typeId,
      weight: input.weightGrams,
      weight_unit: "g",
      width: input.widthCm,
      height: input.heightCm,
      depth: input.depthCm,
      dimension_unit: "cm",
      vat: "0",
      images: input.images,
      attributes: input.attributes.map((attr) => ({
        id: attr.id,
        values: [
          {
            value: attr.value ?? "",
            ...(attr.dictionaryValueId ? { dictionary_value_id: attr.dictionaryValueId } : {}),
          },
        ],
      })),
    },
  ]);

  // task_id'yi DB'ye kalıcı yazıyoruz — sadece bellekte tutsaydık deploy/restart'ta kaybolurdu.
  await prisma.product.update({
    where: { offerId: input.offerId },
    data: { importTaskId: result.task_id },
  });

  return { taskId: result.task_id };
}

export type ProductImportStatus = "pending" | "imported" | "failed";

export async function checkImportStatus(offerId: string) {
  const existing = await prisma.product.findUnique({ where: { offerId } });
  if (!existing) {
    throw new Error(`Unknown offerId: ${offerId}`);
  }

  if (!existing.importTaskId) {
    return { status: existing.status as ProductImportStatus, ozonProductId: existing.ozonProductId, error: existing.lastError };
  }

  const { result } = await getImportStatus(Number(existing.importTaskId));
  const item = result.items.find((i) => i.offer_id === offerId) ?? result.items[0];

  if (item.status === "pending") {
    return { status: "pending" as const, ozonProductId: null, error: null };
  }

  // Ozon "imported" olsa bile uyarı seviyesinde error döndürebiliyor (örn. görsel indirilemedi ama
  // ürün gene de oluştu). Gerçek başarısızlık ölçütü product_id'nin dolu olup olmadığı, errors.length değil.
  const created = item.product_id > 0;
  const status: ProductImportStatus = created ? "imported" : "failed";
  const errorMessage = item.errors.length > 0 ? item.errors.map((e) => e.description).join("; ") : null;

  await prisma.product.update({
    where: { offerId },
    data: {
      status,
      lastError: errorMessage,
      ozonProductId: created ? String(item.product_id) : null,
      importTaskId: null,
      lastSyncedAt: new Date(),
    },
  });

  return { status, ozonProductId: created ? String(item.product_id) : null, error: errorMessage };
}

export async function listAllProducts() {
  return prisma.product.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getProduct(offerId: string) {
  return prisma.product.findUnique({ where: { offerId } });
}

export async function updateProductPrice(offerId: string, costPrice: string) {
  const price = computeSalePrice(costPrice);

  const { result } = await updatePrices([{ offerId, price }]);
  const entry = result.find((r) => r.offer_id === offerId);
  if (entry && !entry.updated) {
    throw new Error(entry.errors.map((e) => e.message).join("; ") || "Fiyat güncellenemedi");
  }

  await prisma.product.update({ where: { offerId }, data: { costPrice, price } });
  return { price };
}

// Ozon'da ayrı bir "sadece görsel güncelle" endpoint'i güvenilir çalışmadığı için (belirsiz
// VALIDATION ERROR), aynı product/import mekanizmasını kullanıyoruz. Kategoriye özel dictionary
// attribute'ları (tip/marka vb.) tekrar göndermesek de Ozon'da korunuyor — sadece ağırlık/boyut
// ve model name (9048) her seferinde yeniden gönderilmek zorunda, aksi halde "zorunlu alan boş" hatası alınıyor.
export async function updateProductImages(offerId: string, images: string[]) {
  const product = await prisma.product.findUnique({ where: { offerId } });
  if (!product?.ozonProductId || !product.descriptionCategoryId || !product.typeId) {
    throw new Error("Bu ürün henüz Ozon'da oluşmamış, görseller güncellenemez");
  }

  const { result } = await importProducts([
    {
      offer_id: offerId,
      name: product.name,
      price: product.price,
      currency_code: CURRENCY_CODE,
      category_id: product.descriptionCategoryId,
      description_category_id: product.descriptionCategoryId,
      type_id: product.typeId,
      weight: product.weightGrams ?? 100,
      weight_unit: "g",
      width: product.widthCm ?? 10,
      height: product.heightCm ?? 10,
      depth: product.depthCm ?? 10,
      dimension_unit: "cm",
      vat: "0",
      images,
      attributes: [{ id: MODEL_NAME_ATTRIBUTE_ID, values: [{ value: offerId }] }],
    },
  ]);

  await prisma.product.update({
    where: { offerId },
    data: { images, importTaskId: result.task_id, status: "pending", lastError: null },
  });

  return { images, taskId: result.task_id };
}
