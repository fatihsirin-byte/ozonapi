import { prisma } from "../../db/prisma";
import { computeSalePrice, computeMinPrice, computeOldPrice, computeBillingWeightGrams } from "../../pricing/formula";
import { translateToRussian } from "../../ai/translate";
import { updatePrices, updateStocks, getImportStatus, archiveProducts } from "../../ozon/products";
import { selectWarehouseId } from "../../ozon/warehouses";
import { createProduct, updateProductImages, type ProductAttributeInput } from "./products.service";

// Yeni gönderilen her ürüne varsayılan stok — kullanıcı isteğiyle sabitlendi (2026-07-30).
const DEFAULT_STOCK = 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ozon /v3/product/import asenkron (task_id) — ürün gerçekten Ozon tarafında oluşana kadar
// stok çağrısı sessizce hiçbir şey yapmıyor ya da "PRODUCT_IS_NOT_CREATED" ile reddediyor,
// üstelik product_id atandıktan (import "imported" göründükten) SONRA bile bu durum bir
// süre daha devam edebiliyor (2026-07-30/31'de canlıda doğrulandı — bazı ürünlerde 16
// saniyelik bekleme yetmedi, birkaç dakika sonra tekrar denendiğinde işledi). Bu yüzden
// hem import'un bitmesini bekliyoruz HEM DE stok çağrısının kendisini, başarısız olursa
// (updated:false ya da hata), artan aralıklarla birkaç kez tekrar deniyoruz.
async function waitForImportThenPushStock(
  offerId: string,
  taskId: number,
  stock: number,
  dims: { weightGrams?: number | null; widthCm?: number | null; heightCm?: number | null; depthCm?: number | null },
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(2000);
    try {
      const { result } = await getImportStatus(taskId);
      const item = result.items.find((i) => i.offer_id === offerId) ?? result.items[0];
      if (item?.status !== "pending" && item?.product_id > 0) break;
    } catch {
      // durum kontrolü başarısız oldu, yine de deneme sayısı bitince stok göndermeyi dene
    }
  }

  const warehouseId = selectWarehouseId(dims.weightGrams ?? 100, dims.widthCm, dims.heightCm, dims.depthCm);
  const backoffsMs = [0, 5000, 15000, 30000, 60000, 120000];
  for (const delay of backoffsMs) {
    if (delay > 0) await sleep(delay);
    try {
      const { result } = await updateStocks([{ offerId, stock, warehouseId }]);
      if (result[0]?.updated) {
        await prisma.product.update({ where: { offerId }, data: { stockQuantity: stock } });
        return;
      }
    } catch {
      // bu deneme başarısız oldu, sıradaki (daha uzun) beklemeyle tekrar denenecek
    }
  }
  // Tüm denemeler tükendi — stockQuantity kasıtlı olarak güncellenmiyor ki UI gerçek
  // durumu yansıtsın (stok gerçekte gitmediyse DB de "gitti" yalanı söylemesin).
}

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
            { offerId: { contains: filters.search, mode: "insensitive" as const } },
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
        orderBy: { variantPosition: "asc" },
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

// Ürün kartındaki sağ/sol ok gezinmesi için — aynı filtreyle tüm handle'ları tek seferde
// (sayfalama olmadan) alfabetik sıraya diziyor ve verilen handle'ın komşularını buluyor.
// Önceden istemci tarafında sayfa sayfa gezip sınırlarda ek istek atan kırılgan bir mantık
// vardı (handle o an çekilen sayfada bulunamazsa sessizce hiç çalışmıyordu) — bu, filtreyle
// eşleşmeyen bir bağlamdan gelindiğinde (ör. eski bir link) komşu bulamayıp özelliğin hiç
// tetiklenmemesine yol açıyordu. Tek sorgu + index hesabıyla bu belirsizlik ortadan kalkıyor.
export async function getAdjacentHandles(
  handle: string,
  filters: HandlePageFilters,
  pageSize = 25,
): Promise<{ prevHandle: string | null; prevPage: number; nextHandle: string | null; nextPage: number }> {
  const where = await buildHandleWhere(filters);
  const grouped = await prisma.product.groupBy({
    by: ["shopifyHandle"],
    where,
    orderBy: { shopifyHandle: "asc" },
  });
  const handles = grouped.map((g) => g.shopifyHandle as string);
  const index = handles.indexOf(handle);
  if (index === -1) {
    return { prevHandle: null, prevPage: 1, nextHandle: null, nextPage: 1 };
  }
  const prevHandle = index > 0 ? handles[index - 1] : null;
  const nextHandle = index < handles.length - 1 ? handles[index + 1] : null;
  return {
    prevHandle,
    prevPage: Math.floor((index - 1) / pageSize) + 1,
    nextHandle,
    nextPage: Math.floor((index + 1) / pageSize) + 1,
  };
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
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
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
    orderBy: { variantPosition: "asc" },
  });
}

// Görseller handle içindeki tüm varyantlarda paylaşılıyor (Shopify'da da öyle) — tek seferde
// hepsine yazılır. resendToOzon=true (varsayılan, "Görselleri Kaydet" butonu) ve ürün zaten
// Ozon'a gönderilmişse (ozonProductId dolu), updateProductImages ile gerçekten Ozon'a da
// resend edilir. resendToOzon=false ise sadece DB'ye yazılır — her değişiklikte (yükleme,
// sıralama, kaldırma) otomatik çağrılıp veri kaybını önlemek için, Ozon'u her seferinde
// yeniden işlemeye zorlamadan (moderasyon sıfırlanmasın diye).
export async function updateHandleImages(handle: string, images: string[], resendToOzon = true) {
  await prisma.product.updateMany({ where: { shopifyHandle: handle }, data: { images } });

  const errors: { offerId: string; error: string }[] = [];
  if (resendToOzon) {
    const variants = await prisma.product.findMany({ where: { shopifyHandle: handle } });
    for (const variant of variants) {
      if (variant.ozonProductId) {
        try {
          await updateProductImages(variant.offerId, images);
        } catch (error) {
          errors.push({ offerId: variant.offerId, error: error instanceof Error ? error.message : "Bilinmeyen hata" });
        }
      }
    }
  }
  return { errors };
}

// Ağırlık/alış fiyatı değiştiğinde yeni fiyatı hesaplar ve local DB'ye yazar. Ürün zaten
// Ozon'a gönderilmişse (ozonProductId dolu), sadece fiyatı da hafif uç (/v1/product/import/prices)
// ile otomatik Ozon'a gönderir — ağırlığın kendisi Ozon'da hâlâ değişmez, o ancak görsel/spec
// resend'i gibi tam bir /v3/product/import ile güncellenebiliyor (Ozon'da "sadece ağırlık
// güncelle" diye ayrı bir uç yok).
export async function updateDraftVariant(
  offerId: string,
  data: {
    weightGrams?: number;
    cargoWeightGrams?: number | null;
    costPrice?: string;
    unitsInPack?: number;
    name?: string;
    heavyPackaging?: boolean;
  }
) {
  const existing = await prisma.product.findUnique({ where: { offerId } });
  const weightGrams = data.weightGrams ?? existing?.weightGrams ?? undefined;
  const costPrice = data.costPrice ?? existing?.costPrice ?? undefined;
  const heavyPackaging = data.heavyPackaging !== undefined ? data.heavyPackaging : existing?.heavyPackaging;

  // Net ağırlık (weightGrams) YA DA ağır ambalaj işareti bu çağrıda değiştiyse ve kargo ağırlığı
  // elle verilmediyse, kargo ağırlığını otomatik yeniden hesaplıyoruz (bkz. Product.cargoWeightGrams).
  // Ağır ambalaj toggle'ı paketleme payını değiştirdiği için bunu da tetiklemesi ŞART — aksi halde
  // checkbox fiyatı etkilemiyor gibi görünür (2026-08-10'da canlıda tespit edildi). Gerçek (tartılmış)
  // ağırlık teyit edildiyse (weightConfirmed) dokunmuyoruz.
  const weightNeedsRecalc = data.weightGrams !== undefined || data.heavyPackaging !== undefined;
  const cargoWeightGrams =
    data.cargoWeightGrams !== undefined
      ? data.cargoWeightGrams
      : weightNeedsRecalc && weightGrams && !existing?.weightConfirmed
        ? Math.round(
            computeBillingWeightGrams(weightGrams, existing?.widthCm, existing?.heightCm, existing?.depthCm, heavyPackaging),
          )
        : existing?.cargoWeightGrams;

  const price = costPrice ? computeSalePrice(costPrice, weightGrams, undefined, heavyPackaging, cargoWeightGrams) : existing?.price;
  const finalPrice = price || existing?.price;
  // min_price DB'de tutulmuyor (2026-08-13, kullanıcı talebi) — her gönderimde costPrice'tan anlık hesaplanıyor.
  const minPrice = costPrice ? computeMinPrice(costPrice, weightGrams, undefined, heavyPackaging, cargoWeightGrams) : finalPrice;
  const oldPrice = finalPrice && finalPrice !== existing?.price ? computeOldPrice(finalPrice) : existing?.oldPrice;

  const updated = await prisma.product.update({
    where: { offerId },
    data: { ...data, cargoWeightGrams, price: finalPrice, oldPrice },
  });

  if (updated.ozonProductId && finalPrice) {
    try {
      await updatePrices([{ offerId, price: finalPrice, oldPrice: oldPrice ?? undefined, minPrice: minPrice ?? undefined }]);
    } catch {
      // Fiyat Ozon'a gönderilemedi (örn. Ozon tarafında geçici bir hata) — local DB güncellendi,
      // kullanıcı Fiyat Hesaplayıcı'dan tekrar deneyebilir. Sessizce yutuyoruz ki her tuş
      // vuruşunda (onBlur) kullanıcıya hata göstermek UX'i bozmasın.
    }
  }

  return updated;
}

// Toplu paket (Box/Display) varyantlarında costPrice/weightGrams = taban varyantın değeri ×
// unitsInPack olarak hesaplanır (bkz. Product.packBaseOfferId, restore-bulk-pack-variants.ts).
// Restore sırasında hatalı çıkan (örn. taban ağırlığı yanlışsa) ya da kullanıcının unitsInPack'i
// UI'dan düzelttiği durumlarda bu fonksiyon tabandan yeniden hesaplayıp Ozon'a gönderir.
export async function recalculateFromBase(offerId: string) {
  const variant = await prisma.product.findUnique({ where: { offerId } });
  if (!variant?.packBaseOfferId || !variant.unitsInPack) {
    throw new Error("Bu varyantın taban varyantı veya adedi tanımlı değil");
  }
  const base = await prisma.product.findUnique({ where: { offerId: variant.packBaseOfferId } });
  if (!base?.costPrice) {
    throw new Error("Taban varyant bulunamadı veya alış fiyatı yok");
  }

  const costPrice = (Number(base.costPrice) * variant.unitsInPack).toFixed(2);
  const weightGrams = base.weightGrams ? base.weightGrams * variant.unitsInPack : null;
  return updateDraftVariant(offerId, { costPrice, weightGrams: weightGrams ?? undefined });
}

// Bir taban varyanttan yeni bir "toplu paket" (Box/Display) varyantı türetir — costPrice/
// weightGrams taban × unitsInPack olarak otomatik hesaplanır (bkz. recalculateFromBase).
// offerId taban offerId'sine "-xN" eklenerek üretilir, çakışırsa sona sayaç eklenir.
export async function createCascadeVariant(params: { baseOfferId: string; unitsInPack: number; name?: string }) {
  const base = await prisma.product.findUnique({ where: { offerId: params.baseOfferId } });
  if (!base) throw new Error("Taban varyant bulunamadı");
  if (!base.costPrice) throw new Error("Taban varyantın alış fiyatı yok");

  let offerId = `${params.baseOfferId}-x${params.unitsInPack}`;
  let suffix = 2;
  while (await prisma.product.findUnique({ where: { offerId } })) {
    offerId = `${params.baseOfferId}-x${params.unitsInPack}-${suffix}`;
    suffix++;
  }

  const costPrice = (Number(base.costPrice) * params.unitsInPack).toFixed(2);
  const weightGrams = base.weightGrams ? base.weightGrams * params.unitsInPack : null;
  const cargoWeightGrams = weightGrams
    ? Math.round(computeBillingWeightGrams(weightGrams, base.widthCm, base.heightCm, base.depthCm, base.heavyPackaging))
    : null;
  const price = computeSalePrice(costPrice, weightGrams, undefined, base.heavyPackaging, cargoWeightGrams) || "0";
  const name = params.name?.trim() || `${base.name} - ${params.unitsInPack} Pieces`;

  return prisma.product.create({
    data: {
      offerId,
      name,
      price,
      costPrice,
      weightGrams,
      cargoWeightGrams,
      unitsInPack: params.unitsInPack,
      packBaseOfferId: base.offerId,
      heavyPackaging: base.heavyPackaging,
      widthCm: base.widthCm,
      heightCm: base.heightCm,
      depthCm: base.depthCm,
      images: base.images ?? undefined,
      originalImages: base.originalImages ?? undefined,
      shopifyHandle: base.shopifyHandle,
      shopifyVariantId: offerId,
      shopifyVendor: base.shopifyVendor,
      shopifyType: base.shopifyType,
      shopifyMetafields: base.shopifyMetafields ?? undefined,
      descriptionHtml: base.descriptionHtml,
      variantPosition: (base.variantPosition ?? 0) + 1,
      status: "draft",
    },
  });
}

// Silinen offerId'leri ExcludedOfferId'e kaydeder — CSV tekrar import edilirse bu ürünler
// "yeni satır" sanılıp geri getirilmesin diye (bkz. upsertParsedProducts).
export async function deleteHandles(handles: string[]) {
  const toDelete = await prisma.product.findMany({
    where: { shopifyHandle: { in: handles }, status: "draft" },
    select: { offerId: true },
  });

  await prisma.excludedOfferId.createMany({
    data: toDelete.map((p) => ({ offerId: p.offerId })),
    skipDuplicates: true,
  });

  const result = await prisma.product.deleteMany({ where: { shopifyHandle: { in: handles }, status: "draft" } });
  return result.count;
}

// Tek bir varyantı kalıcı olarak siler (handle'ın diğer varyantlarına dokunmadan).
// Ozon'a zaten gönderilmiş bir varyantı da silebiliyoruz — bu durumda önce Ozon'da arşive
// alıyoruz (silinemiyor, sadece arşivlenebiliyor — bkz. ürün listesi "Archive" bölümü),
// sonra kendi tarafımızda kalıcı olarak siliyoruz. Ozon tarafı başarısız olsa bile (örn. ürün
// zaten orada yoksa) yerel silme işlemine devam ediyoruz ki kullanıcı takılıp kalmasın.
export async function deleteVariant(offerId: string) {
  const product = await prisma.product.findUnique({ where: { offerId } });
  if (!product) return false;

  if (product.ozonProductId) {
    try {
      await archiveProducts([Number(product.ozonProductId)]);
    } catch {
      // Ozon'da zaten yok/arşivlenemedi — yerel silmeye yine de devam et
    }
  }

  await prisma.excludedOfferId.upsert({ where: { offerId }, create: { offerId }, update: {} });
  await prisma.product.delete({ where: { offerId } });
  return true;
}

// Bir varyantı "pasif" işaretler — silinmez, ama submitHandleToOzon bu varyantı atlar.
// Kullanıcı istediğinde tekrar aktifleştirebilir.
export async function setVariantExcludedFromSubmit(offerId: string, excluded: boolean) {
  return prisma.product.update({ where: { offerId }, data: { excludedFromSubmit: excluded } });
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

// Gemini çevirisini handle başına bir kez yapıp tüm varyantlara cache'ler — ama varyantların
// kendi özgün isimleri olabiliyor (örn. "1 Piece" vs "1 Display - 16 Pieces x 29g" gibi farklı
// paket/adet varyantları aynı handle'ı paylaşıyor). Eskiden İLK varyantın çevrilmiş ismi TÜM
// varyantlara kopyalanıyordu — bu, "1 Piece" varyantının Rusça adının yanlışlıkla "16 штук"
// (16'lık kutunun ismi) olmasına yol açtı (2026-07-31'de canlıda tespit edildi). Artık her
// BENZERSİZ isim için ayrı çeviri yapılıyor (aynı isimli varyantlar arasında tekrar token
// harcanmıyor), açıklama ise (genelde tüm varyantlarda aynı olduğu için) tek seferlik
// sonuçtan paylaşılıyor.
export async function translateHandle(handle: string) {
  const variants = await prisma.product.findMany({
    where: { shopifyHandle: handle },
    orderBy: { variantPosition: "asc" },
  });
  if (variants.length === 0) throw new Error("Handle bulunamadı");

  const first = variants[0];
  const firstResult = await translateToRussian(first.name, first.descriptionHtml ?? "", first.shopifyVendor);
  const descriptionRu = firstResult.descriptionRu;
  const nameRuByName = new Map<string, string>([[first.name, firstResult.nameRu]]);

  for (const variant of variants) {
    if (!nameRuByName.has(variant.name)) {
      const { nameRu } = await translateToRussian(variant.name, variant.descriptionHtml ?? "", variant.shopifyVendor);
      nameRuByName.set(variant.name, nameRu);
    }
    await prisma.product.update({
      where: { offerId: variant.offerId },
      data: { nameRu: nameRuByName.get(variant.name), descriptionRu },
    });
  }

  return { nameRu: nameRuByName.get(first.name)!, descriptionRu };
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
    where: { shopifyHandle: input.handle, excludedFromSubmit: false },
    include: { modelGroup: true },
  });
  if (variants.length === 0) throw new Error("Bu handle için gönderilecek (pasif olmayan) varyant bulunamadı");

  const results: { offerId: string; taskId?: string; error?: string }[] = [];

  for (const variant of variants) {
    // ModelGroup varsa (farklı Shopify handle'ları elle birleştirilmişse) onun adı öncelikli.
    // Yoksa, handle'ın kendi varyantlarının Ozon'da OTOMATİK tek kartta birleşmesi için model
    // adı olarak handle'ın kendisini kullanıyoruz — önceden buraya offerId düşüyordu, bu da
    // her varyantın (offerId'ler farklı olduğu için) KENDİ başına ayrı bir kart açmasına yol
    // açıyordu; aynı üründeki 3 varyant Ozon'da 3 ayrı ürün gibi görünüyordu (2026-08-03'te
    // canlıda tespit edildi).
    const modelNameOverride = variant.modelGroup?.name ?? input.handle;
    try {
      // Ozon Rusça olmayan (Latin harfli) ürün adını "critical" hata olarak reddediyor —
      // çeviri yapıldıysa (nameRu) onu kullan, yoksa orijinal (İngilizce) adı gönder.
      const { taskId } = await createProduct({
        offerId: variant.offerId,
        name: input.nameOverrideByOfferId?.[variant.offerId] ?? variant.nameRu ?? variant.name,
        costPrice: variant.costPrice ?? "0",
        images: Array.isArray(variant.images) ? (variant.images as string[]) : [],
        descriptionCategoryId: input.descriptionCategoryId,
        typeId: input.typeId,
        weightGrams: variant.weightGrams ?? 100,
        cargoWeightGrams: variant.cargoWeightGrams,
        widthCm: variant.widthCm ?? 10,
        heightCm: variant.heightCm ?? 10,
        depthCm: variant.depthCm ?? 10,
        attributes: input.attributes,
        modelNameOverride,
        descriptionRu: variant.descriptionRu,
        unitsInPack: variant.unitsInPack,
        heavyPackaging: variant.heavyPackaging,
      });
      if (taskId) {
        // Bilerek await edilmiyor — import'un bitmesini beklemek saniyeler sürebiliyor,
        // bu da toplu gönderimi yavaşlatır. Arka planda biter, hata olsa bile ürün
        // oluşturma başarılı sayılır (stok daha sonra "Stokları Gönder" ile tekrar denenebilir).
        waitForImportThenPushStock(variant.offerId, Number(taskId), DEFAULT_STOCK, {
          weightGrams: variant.weightGrams,
          widthCm: variant.widthCm,
          heightCm: variant.heightCm,
          depthCm: variant.depthCm,
        }).catch(() => {});
      }
      results.push({ offerId: variant.offerId, taskId: taskId ? String(taskId) : undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bilinmeyen hata";
      results.push({ offerId: variant.offerId, error: message });
    }
  }

  return results;
}
