import { prisma } from "../../db/prisma";
import { importProducts, getImportStatus, updatePrices, getProductAttributes, getProductInfoList } from "../../ozon/products";
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
  // Farklı Shopify handle'larını (ModelGroup) tek Ozon kartında birleştirirken 9048 attribute'una
  // grubun tüm üyeleri için aynı değeri yazmak için — verilmezse offerId kullanılır (mevcut davranış).
  modelNameOverride?: string;
}

export async function createProduct(input: CreateProductInput) {
  const price = computeSalePrice(input.costPrice, input.weightGrams, {
    widthCm: input.widthCm,
    heightCm: input.heightCm,
    depthCm: input.depthCm,
  });

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
      attributes: [
        ...input.attributes
          .filter((attr) => attr.id !== MODEL_NAME_ATTRIBUTE_ID)
          .map((attr) => ({
            id: attr.id,
            values: [
              {
                value: attr.value ?? "",
                ...(attr.dictionaryValueId ? { dictionary_value_id: attr.dictionaryValueId } : {}),
              },
            ],
          })),
        { id: MODEL_NAME_ATTRIBUTE_ID, values: [{ value: input.modelNameOverride ?? input.offerId }] },
      ],
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

// Shopify CSV içe aktarımından gelen "draft" satırlar (binlerce olabilir) burada listelenmiyor —
// onlar /import sayfasında ayrı, sayfalanmış bir listede yönetiliyor (bkz. staging.service.ts).
export async function listAllProducts() {
  return prisma.product.findMany({ where: { status: { not: "draft" } }, orderBy: { createdAt: "desc" } });
}

export async function getProduct(offerId: string) {
  return prisma.product.findUnique({ where: { offerId } });
}

// priceOverride verilirse (Fiyat Hesaplayıcı modalında elle girilen satış fiyatı) formülü
// yeniden hesaplamadan doğrudan o fiyat Ozon'a gönderilir — aksi halde costPrice'tan
// formülle hesaplanan önerilen fiyat kullanılır (mevcut davranış).
export async function updateProductPrice(offerId: string, costPrice: string, priceOverride?: string) {
  const existing = await prisma.product.findUnique({ where: { offerId } });
  const price =
    priceOverride ||
    computeSalePrice(costPrice, existing?.weightGrams, {
      widthCm: existing?.widthCm,
      heightCm: existing?.heightCm,
      depthCm: existing?.depthCm,
    });

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
  const product = await prisma.product.findUnique({ where: { offerId }, include: { modelGroup: true } });
  if (!product?.ozonProductId || !product.descriptionCategoryId || !product.typeId) {
    throw new Error("Bu ürün henüz Ozon'da oluşmamış, görseller güncellenemez");
  }
  const modelName = product.modelGroup?.name ?? offerId;

  const { result } = await importProducts([
    {
      offer_id: offerId,
      // nameRu varsa onu kullan — yoksa Ozon Latin harfli isme "critical" hata verir. Bunu
      // resendetmeyi unutursak (product.name kullanırsak) daha önce çevrilmiş isim burada
      // sessizce İngilizce'ye geri döner.
      name: product.nameRu ?? product.name,
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
      attributes: [{ id: MODEL_NAME_ATTRIBUTE_ID, values: [{ value: modelName }] }],
    },
  ]);

  await prisma.product.update({
    where: { offerId },
    data: { images, importTaskId: result.task_id, status: "pending", lastError: null },
  });

  return { images, taskId: result.task_id };
}

// Ozon'a gönderilmiş bir ürünün kategori/attribute'larını sonradan değiştirir — updateProductImages
// ile aynı mantık (ayrı bir "sadece attribute güncelle" endpoint'i yok, tüm ürünü yeniden gönderiyoruz).
export async function updateProductCategoryAttributes(
  offerId: string,
  input: { descriptionCategoryId: number; typeId: number; attributes: ProductAttributeInput[] },
) {
  const product = await prisma.product.findUnique({ where: { offerId }, include: { modelGroup: true } });
  if (!product?.ozonProductId) {
    throw new Error("Bu ürün henüz Ozon'da oluşmamış, özellikler güncellenemez");
  }
  const modelName = product.modelGroup?.name ?? offerId;
  const images = Array.isArray(product.images) ? (product.images as string[]) : [];

  const { result } = await importProducts([
    {
      offer_id: offerId,
      name: product.nameRu ?? product.name,
      price: product.price,
      currency_code: CURRENCY_CODE,
      category_id: input.descriptionCategoryId,
      description_category_id: input.descriptionCategoryId,
      type_id: input.typeId,
      weight: product.weightGrams ?? 100,
      weight_unit: "g",
      width: product.widthCm ?? 10,
      height: product.heightCm ?? 10,
      depth: product.depthCm ?? 10,
      dimension_unit: "cm",
      vat: "0",
      images,
      attributes: [
        ...input.attributes
          .filter((attr) => attr.id !== MODEL_NAME_ATTRIBUTE_ID)
          .map((attr) => ({
            id: attr.id,
            values: [
              {
                value: attr.value ?? "",
                ...(attr.dictionaryValueId ? { dictionary_value_id: attr.dictionaryValueId } : {}),
              },
            ],
          })),
        { id: MODEL_NAME_ATTRIBUTE_ID, values: [{ value: modelName }] },
      ],
    },
  ]);

  await prisma.product.update({
    where: { offerId },
    data: {
      descriptionCategoryId: input.descriptionCategoryId,
      typeId: input.typeId,
      importTaskId: result.task_id,
      status: "pending",
      lastError: null,
    },
  });

  return { taskId: result.task_id };
}

function mmToCm(value: number, unit: string): number {
  if (unit === "mm") return Math.round(value / 10);
  if (unit === "m") return Math.round(value * 100);
  return value;
}

// Ozon'da zaten var olan ama bizim panelden oluşturulmamış bir ürünü sisteme çeker —
// sonra normal düzenleme sayfasından (fiyat/görsel) yönetilebilsin diye.
export async function importFromOzon(offerId: string) {
  const [attrResult, infoResult] = await Promise.all([
    getProductAttributes([offerId]),
    getProductInfoList([offerId]),
  ]);

  const attrItem = attrResult.result[0];
  if (!attrItem) {
    throw new Error("Bu offer_id Ozon'da bulunamadı");
  }
  const infoItem = infoResult.items[0] as
    | { price?: string; currency_code?: string; id?: number }
    | undefined;

  const product = await prisma.product.upsert({
    where: { offerId },
    create: {
      offerId,
      name: attrItem.name,
      price: infoItem?.price ?? "0",
      currencyCode: infoItem?.currency_code ?? CURRENCY_CODE,
      weightGrams: attrItem.weight,
      widthCm: mmToCm(attrItem.width, attrItem.dimension_unit),
      heightCm: mmToCm(attrItem.height, attrItem.dimension_unit),
      depthCm: mmToCm(attrItem.depth, attrItem.dimension_unit),
      descriptionCategoryId: attrItem.description_category_id,
      typeId: attrItem.type_id,
      images: attrItem.images,
      ozonProductId: String(attrItem.id),
      status: "imported",
    },
    update: {
      name: attrItem.name,
      price: infoItem?.price ?? "0",
      currencyCode: infoItem?.currency_code ?? CURRENCY_CODE,
      weightGrams: attrItem.weight,
      widthCm: mmToCm(attrItem.width, attrItem.dimension_unit),
      heightCm: mmToCm(attrItem.height, attrItem.dimension_unit),
      depthCm: mmToCm(attrItem.depth, attrItem.dimension_unit),
      descriptionCategoryId: attrItem.description_category_id,
      typeId: attrItem.type_id,
      images: attrItem.images,
      ozonProductId: String(attrItem.id),
      status: "imported",
    },
  });

  return product;
}
