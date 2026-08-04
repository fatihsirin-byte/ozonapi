import { prisma } from "../../db/prisma";
import { importProducts, getImportStatus, updatePrices, updateStocks, getProductAttributes, getProductInfoList } from "../../ozon/products";
import { getCategoryAttributes } from "../../ozon/categories";
import { selectWarehouseId } from "../../ozon/warehouses";
import { buildRichContentJson } from "../../ozon/rich-content";
import { computeSalePrice, computeOldPrice } from "../../pricing/formula";

// Ozon hesabının sözleşme para birimi USD — RUB gönderilirse ürün sessizce "pending" kalıp
// sonunda currency_differs_from_contract hatasıyla düşüyor (Faz 1'de keşfedildi).
const CURRENCY_CODE = "USD";

// Ozon'un varyant gruplama alanı — product.service.ts ve wizard'da aynı sabit kullanılıyor.
const MODEL_NAME_ATTRIBUTE_ID = 9048;

// "Annotation" (Kısa bilgi) ve "Product weight, g" — kategori formunda kullanıcıya
// gösterilmiyor ama içerik puanının büyük kısmını (Product description bloğu) bu tek alan
// belirliyor. Elimizde zaten olan descriptionRu/weightGrams'ı bu ID'lere otomatik yazıyoruz;
// kategori bu attribute'ları tanımıyorsa (id kategori şemasında yoksa) hiç göndermiyoruz.
const ANNOTATION_ATTRIBUTE_ID = 4191;
const WEIGHT_GRAMS_ATTRIBUTE_ID = 4383;
const PACKED_WEIGHT_GRAMS_ATTRIBUTE_ID = 4497;
// "Birimler tek bir üründe" (kutu/paket içi adet) — ağırlık gibi varyanttan varyanta
// farklı olabiliyor (örn. "1 adet" / "6 adet") ama kategori formunda TEK bir kere girilip
// tüm varyantlara aynen kopyalanıyordu. Bu yüzden Ozon'un varyant birleştirme kuralı (en az
// bir attribute'un farklı olması) sağlanamıyor, aynı üründeki varyantlar ayrı kartlara
// düşüyordu (2026-08-03'te canlıda tespit edildi). Artık weightGrams gibi Product'ın kendi
// unitsInPack alanından, her varyant için ayrı ayrı senkronlanıyor.
const UNITS_IN_PACK_ATTRIBUTE_ID = 8962;
// "Rich content" (kategori formunda hiç gösterilmiyor, içerik puanının büyük kısmını
// belirliyor) — kullanıcının Rich content design tool'da oluşturup kaydettiği gerçek JSON
// çıktısından şema alınıp descriptionRu'dan otomatik üretiliyor (bkz. ozon/rich-content.ts).
const RICH_CONTENT_ATTRIBUTE_ID = 11254;

// Ozon'un "#Hashtag'ler" attribute'u kesin format istiyor: her hashtag "#" ile başlamalı,
// sadece harf/rakam/alt çizgi içermeli, boşlukla ayrılmalı. Kullanıcı elle "halva" gibi
// "#"sız bir kelime yazınca Ozon bunu (moderasyonu engellemeyen ama içerik puanını düşüren)
// bir uyarı olarak işaretliyor — burada göndermeden önce otomatik düzeltiyoruz.
const HASHTAG_NAME_PATTERN = /hashtag|хештег/i;

// "Kısa bilgi" (Annotation, 4191) gerçekten KISA olmalı — tam descriptionRu'yu (madde madde
// özellikler/karakteristikler/içindekiler/alerjen uyarısı dahil, genelde 2000+ karakter) olduğu
// gibi bu alana bassak Ozon satır sonlarını yok sayıp hepsini tek bloğa yapıştırıyor; ortaya
// "*" işaretli kısa parçaların üst üste bindiği bir yığın çıkıyor ve Ozon'un moderasyonu bunu
// "aynı tür sayılarla aşırı yüklü" diye reddediyor (2026-08-04'te canlıda tespit edildi). Tam
// metin zaten Rich Content'te (11254, formatlı) duruyor — Annotation'a sadece ilk paragrafın
// (madde listeleri başlamadan önceki tanıtım metni) kısaltılmış hali yeterli.
const ANNOTATION_MAX_LENGTH = 500;

// Bazı ürünlerde (özellikle çeviri paragraf arası boşluk bırakmadan tek blok üretmişse)
// "Ингредиенты:", "Предупреждение об аллергенах:" gibi bölüm başlıkları hiç \n\n ile ayrılmadan
// asıl tanıtım cümlesiyle AYNI paragrafta geliyor — bu durumda "ilk paragrafı al" mantığı
// malzeme listesini de (virgülle art arda dizilmiş kelimeler) Annotation'a taşıyordu, Ozon bunu
// "kelime listesi, tutarlı açıklama değil" diye reddediyordu (2026-08-04'te canlıda, gerçek
// zamanlı — önceki "stale moderasyon" varsayımım YANLIŞTI, bu bir kerelik değil süregelen bir
// üretim hatasıydı). Artık bu bölüm başlıklarından biri ilk paragrafın İÇİNDE de geçse, oradan
// itibaren kesiliyor.
const LIST_SECTION_MARKERS = [
  "Ингредиенты:",
  "Особенности продукта:",
  "Характеристики продукта:",
  "Предупреждение об аллергенах:",
  "Хранение:",
  "Срок годности:",
  "Упаковка:",
];

function extractShortAnnotation(descriptionRu: string): string {
  let text = descriptionRu.split(/\n\s*\n/)[0]?.trim() || descriptionRu.trim();

  let earliestMarkerIndex = -1;
  for (const marker of LIST_SECTION_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && (earliestMarkerIndex === -1 || idx < earliestMarkerIndex)) {
      earliestMarkerIndex = idx;
    }
  }
  if (earliestMarkerIndex !== -1) {
    text = text.slice(0, earliestMarkerIndex).trim();
  }

  if (text.length <= ANNOTATION_MAX_LENGTH) return text;

  const truncated = text.slice(0, ANNOTATION_MAX_LENGTH);
  const lastSentenceEnd = Math.max(truncated.lastIndexOf(". "), truncated.lastIndexOf("! "), truncated.lastIndexOf("? "));
  return lastSentenceEnd > ANNOTATION_MAX_LENGTH * 0.5 ? truncated.slice(0, lastSentenceEnd + 1) : `${truncated.trim()}...`;
}

function normalizeHashtagValue(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const cleaned = token.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "_");
      return cleaned ? `#${cleaned}` : "";
    })
    .filter(Boolean)
    .join(" ");
}

// Gönderilecek attribute listesini kategori şemasına göre otomatik düzeltir/tamamlar:
// (1) Annotation/ağırlık attribute'ları eksikse ve kategori destekliyorsa elimizdeki
// descriptionRu/weightGrams'tan ekler, (2) hashtag-tipi attribute'ların değeri format
// dışıysa normalize eder. Kategori şeması çekilemezse hiçbir şey değiştirmeden devam eder.
async function applyContentAttributeFixes(
  descriptionCategoryId: number,
  typeId: number,
  attributes: ProductAttributeInput[],
  data: { descriptionRu?: string | null; weightGrams?: number | null; unitsInPack?: number | null; title?: string | null },
): Promise<ProductAttributeInput[]> {
  const existingIds = new Set(attributes.map((a) => a.id));
  const needsRichContent = !existingIds.has(RICH_CONTENT_ATTRIBUTE_ID) && !!data.descriptionRu;
  const hasHashtagCandidate = attributes.some(
    (a) => typeof a.value === "string" && a.value.trim() && !/^#\S+(\s+#\S+)*$/.test(a.value.trim()),
  );
  if (!data.descriptionRu && !needsRichContent && !hasHashtagCandidate && !data.weightGrams && !data.unitsInPack) {
    return attributes;
  }

  try {
    const { result } = await getCategoryAttributes({ descriptionCategoryId, typeId });
    const byId = new Map(result.map((a) => [a.id, a]));

    // Ağırlık (4383/4497) ve kutu-içi-adet (8962) attribute'larını her zaman GÜNCEL DB
    // değerleriyle senkronluyoruz — sadece eksikse eklemek yetmiyordu: bir varyantın
    // ağırlığı/adedi sonradan değişince (örn. "1 adet" ile "6 adet" varyantları) eski/yanlış
    // değer Ozon'da kalıcı olarak duruyordu. Bu da Ozon'un varyant birleştirme kuralını
    // (en az bir attribute'un farklı olması) bozup aynı üründeki varyantların ayrı
    // kartlara düşmesine yol açıyordu (2026-08-03'te canlıda tespit edildi).
    const fixed = attributes
      .filter((attr) => !data.weightGrams || (attr.id !== WEIGHT_GRAMS_ATTRIBUTE_ID && attr.id !== PACKED_WEIGHT_GRAMS_ATTRIBUTE_ID))
      .filter((attr) => !data.unitsInPack || attr.id !== UNITS_IN_PACK_ATTRIBUTE_ID)
      .filter((attr) => !data.descriptionRu || attr.id !== ANNOTATION_ATTRIBUTE_ID)
      .map((attr) => {
        const schema = byId.get(attr.id);
        if (schema && HASHTAG_NAME_PATTERN.test(schema.name) && typeof attr.value === "string" && attr.value.trim()) {
          return { ...attr, value: normalizeHashtagValue(attr.value) };
        }
        return attr;
      });

    if (data.weightGrams) {
      if (byId.has(WEIGHT_GRAMS_ATTRIBUTE_ID)) {
        fixed.push({ id: WEIGHT_GRAMS_ATTRIBUTE_ID, value: String(data.weightGrams) });
      }
      if (byId.has(PACKED_WEIGHT_GRAMS_ATTRIBUTE_ID)) {
        fixed.push({ id: PACKED_WEIGHT_GRAMS_ATTRIBUTE_ID, value: String(data.weightGrams) });
      }
    }
    if (data.unitsInPack && byId.has(UNITS_IN_PACK_ATTRIBUTE_ID)) {
      fixed.push({ id: UNITS_IN_PACK_ATTRIBUTE_ID, value: String(data.unitsInPack) });
    }

    if (data.descriptionRu && byId.has(ANNOTATION_ATTRIBUTE_ID)) {
      fixed.push({ id: ANNOTATION_ATTRIBUTE_ID, value: extractShortAnnotation(data.descriptionRu) });
    }
    if (needsRichContent && byId.has(RICH_CONTENT_ATTRIBUTE_ID)) {
      fixed.push({
        id: RICH_CONTENT_ATTRIBUTE_ID,
        value: buildRichContentJson(data.descriptionRu!, data.title ?? undefined),
      });
    }
    return fixed;
  } catch {
    return attributes;
  }
}

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
  unitsInPack?: number | null;
  heavyPackaging?: boolean;
  attributes: ProductAttributeInput[];
  // Farklı Shopify handle'larını (ModelGroup) tek Ozon kartında birleştirirken 9048 attribute'una
  // grubun tüm üyeleri için aynı değeri yazmak için — verilmezse offerId kullanılır (mevcut davranış).
  modelNameOverride?: string;
  descriptionRu?: string | null;
}

export async function createProduct(input: CreateProductInput) {
  const price = computeSalePrice(
    input.costPrice,
    input.weightGrams,
    { widthCm: input.widthCm, heightCm: input.heightCm, depthCm: input.depthCm },
    input.heavyPackaging,
  );
  const oldPrice = computeOldPrice(price);

  await prisma.product.upsert({
    where: { offerId: input.offerId },
    create: {
      offerId: input.offerId,
      name: input.name,
      price,
      oldPrice,
      costPrice: input.costPrice,
      currencyCode: CURRENCY_CODE,
      weightGrams: input.weightGrams,
      unitsInPack: input.unitsInPack,
      heavyPackaging: input.heavyPackaging,
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
      oldPrice,
      costPrice: input.costPrice,
      currencyCode: CURRENCY_CODE,
      weightGrams: input.weightGrams,
      unitsInPack: input.unitsInPack,
      heavyPackaging: input.heavyPackaging,
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

  const baseAttributes = await applyContentAttributeFixes(
    input.descriptionCategoryId,
    input.typeId,
    input.attributes.filter((attr) => attr.id !== MODEL_NAME_ATTRIBUTE_ID),
    {
      descriptionRu: input.descriptionRu,
      weightGrams: input.weightGrams,
      unitsInPack: input.unitsInPack,
      title: input.name,
    },
  );

  const { result } = await importProducts([
    {
      offer_id: input.offerId,
      name: input.name,
      price,
      old_price: oldPrice,
      min_price: price,
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
        ...baseAttributes.map((attr) => ({
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

// Ozon'a bağlı (ozonProductId'si olan) HER ürünün stoğunu tek bir sabit adede ayarlar.
// /v2/products/stocks tek çağrıda en fazla 100 offer_id kabul ediyor, o yüzden 100'lük
// gruplara bölüp gönderiyoruz.
const STOCK_BATCH_SIZE = 100;

export async function setStockForAllConnectedProducts(stock: number) {
  const products = await prisma.product.findMany({
    where: { ozonProductId: { not: null } },
    select: { offerId: true, weightGrams: true, widthCm: true, heightCm: true, depthCm: true },
  });

  const results: { offerId: string; updated: boolean; error?: string }[] = [];

  for (let i = 0; i < products.length; i += STOCK_BATCH_SIZE) {
    const batch = products.slice(i, i + STOCK_BATCH_SIZE);
    const { result } = await updateStocks(
      batch.map((p) => ({
        offerId: p.offerId,
        stock,
        warehouseId: selectWarehouseId(p.weightGrams ?? 100, p.widthCm, p.heightCm, p.depthCm),
      })),
    );
    for (const entry of result) {
      results.push({
        offerId: entry.offer_id,
        updated: entry.updated,
        error: entry.updated ? undefined : entry.errors.map((e) => e.message).join("; "),
      });
    }
  }

  const updatedOfferIds = results.filter((r) => r.updated).map((r) => r.offerId);
  if (updatedOfferIds.length > 0) {
    await prisma.product.updateMany({
      where: { offerId: { in: updatedOfferIds } },
      data: { stockQuantity: stock },
    });
  }

  return { total: products.length, updated: updatedOfferIds.length, results };
}

// waitForImportThenPushStock (staging.service.ts) fire-and-forget çalışıyor — birden fazla
// ürün art arda ("sonraki ürüne otomatik geç") gönderilince aynı anda birden fazla stok push
// zinciri üst üste biniyor, bazılarında tüm backoff denemeleri (toplam ~4 dakika) tükenip
// stockQuantity null kalabiliyor — bu durumda ürün Ozon'da "Satışa hazır" görünüp gerçekte
// satışa açılmıyor ("Depoda yok"). Bu fonksiyon periyodik cron'da bu "unutulmuş" ürünleri
// bulup stok göndermeyi tekrar dener (2026-08-04'te canlıda tespit edildi).
export async function backfillMissingStock(stock: number) {
  const products = await prisma.product.findMany({
    where: { ozonProductId: { not: null }, stockQuantity: null },
    select: { offerId: true, weightGrams: true, widthCm: true, heightCm: true, depthCm: true },
  });
  if (products.length === 0) return { total: 0, updated: 0, results: [] };

  const results: { offerId: string; updated: boolean; error?: string }[] = [];
  for (let i = 0; i < products.length; i += STOCK_BATCH_SIZE) {
    const batch = products.slice(i, i + STOCK_BATCH_SIZE);
    const { result } = await updateStocks(
      batch.map((p) => ({
        offerId: p.offerId,
        stock,
        warehouseId: selectWarehouseId(p.weightGrams ?? 100, p.widthCm, p.heightCm, p.depthCm),
      })),
    );
    for (const entry of result) {
      results.push({
        offerId: entry.offer_id,
        updated: entry.updated,
        error: entry.updated ? undefined : entry.errors.map((e) => e.message).join("; "),
      });
    }
  }

  const updatedOfferIds = results.filter((r) => r.updated).map((r) => r.offerId);
  if (updatedOfferIds.length > 0) {
    await prisma.product.updateMany({ where: { offerId: { in: updatedOfferIds } }, data: { stockQuantity: stock } });
  }

  return { total: products.length, updated: updatedOfferIds.length, results };
}

// priceOverride verilirse (Fiyat Hesaplayıcı modalında elle girilen satış fiyatı) formülü
// yeniden hesaplamadan doğrudan o fiyat Ozon'a gönderilir — aksi halde costPrice'tan
// formülle hesaplanan önerilen fiyat kullanılır (mevcut davranış).
export async function updateProductPrice(offerId: string, costPrice: string, priceOverride?: string) {
  const existing = await prisma.product.findUnique({ where: { offerId } });
  const price =
    priceOverride ||
    computeSalePrice(
      costPrice,
      existing?.weightGrams,
      { widthCm: existing?.widthCm, heightCm: existing?.heightCm, depthCm: existing?.depthCm },
      existing?.heavyPackaging,
    );

  const oldPrice = computeOldPrice(price);
  const { result } = await updatePrices([{ offerId, price, oldPrice }]);
  const entry = result.find((r) => r.offer_id === offerId);
  if (entry && !entry.updated) {
    throw new Error(entry.errors.map((e) => e.message).join("; ") || "Fiyat güncellenemedi");
  }

  await prisma.product.update({ where: { offerId }, data: { costPrice, price, oldPrice } });
  return { price };
}

// Metal kutu/ağır ambalaj gibi standart dışı ürünlerde "ağır ambalaj" işaretini günceller ve
// fiyatı bu yeni ağırlık varsayımıyla (paketleme yüzdesi 2.5 katına çıkar) yeniden hesaplayıp Ozon'a gönderir.
export async function updateProductHeavyPackaging(offerId: string, heavyPackaging: boolean) {
  const existing = await prisma.product.findUnique({ where: { offerId } });
  if (!existing?.costPrice) {
    await prisma.product.update({ where: { offerId }, data: { heavyPackaging } });
    return { price: null };
  }

  await prisma.product.update({ where: { offerId }, data: { heavyPackaging } });
  return updateProductPrice(offerId, existing.costPrice);
}

// ÖNEMLİ: Ozon'un /v3/product/import'u attribute'lar için MERGE değil, TAM REPLACE yapıyor —
// gönderilmeyen bir attribute "korunmuyor", siliniyor (bu, 2026-07-30'da canlıda Composition
// ve diğer tüm attribute'ların bir görsel-resend sonrası silinmesiyle doğrulandı; önceki yorum
// "resend etmesek de korunuyor" diyordu, bu YANLIŞTI). Bu yüzden her resend'de Ozon'daki GÜNCEL
// attribute'ları önce çekip yeniden gönderiyoruz — aksi halde attribute'lar sessizce kayboluyor.
async function getLiveOzonAttributes(offerId: string): Promise<ProductAttributeInput[]> {
  try {
    const { result } = await getProductAttributes([offerId]);
    const item = result[0];
    if (!item) return [];
    return item.attributes
      .filter((attr) => attr.id !== MODEL_NAME_ATTRIBUTE_ID)
      .map((attr) => {
        const v = attr.values[0];
        return {
          id: attr.id,
          value: v?.dictionary_value_id ? undefined : v?.value,
          dictionaryValueId: v?.dictionary_value_id || undefined,
        };
      });
  } catch {
    // Ozon'dan mevcut attribute'lar çekilemedi — üst fonksiyon zaten sadece elindeki
    // attribute'ları (varsa) gönderecek, burada ekstra bir şey yapmıyoruz.
    return [];
  }
}

function buildAttributesPayload(attributes: ProductAttributeInput[], modelName: string) {
  return [
    ...attributes.map((attr) => ({
      id: attr.id,
      values: [
        {
          value: attr.value ?? "",
          ...(attr.dictionaryValueId ? { dictionary_value_id: attr.dictionaryValueId } : {}),
        },
      ],
    })),
    { id: MODEL_NAME_ATTRIBUTE_ID, values: [{ value: modelName }] },
  ];
}

// Ozon'da ayrı bir "sadece görsel güncelle" endpoint'i güvenilir çalışmadığı için (belirsiz
// VALIDATION ERROR), aynı product/import mekanizmasını kullanıyoruz.
export async function updateProductImages(offerId: string, images: string[]) {
  const product = await prisma.product.findUnique({ where: { offerId }, include: { modelGroup: true } });
  if (!product?.ozonProductId || !product.descriptionCategoryId || !product.typeId) {
    throw new Error("Bu ürün henüz Ozon'da oluşmamış, görseller güncellenemez");
  }
  // Model adı: modelGroup varsa o öncelikli; yoksa handle'ın kendisi kullanılıyor ki bu
  // resend, aynı handle'ın diğer varyantlarıyla Ozon'da halihazırda birleşmiş kartı
  // offerId'ye çevirip bozmasın (bkz. submitHandleToOzon'daki aynı düzeltme, 2026-08-03).
  const modelName = product.modelGroup?.name ?? product.shopifyHandle ?? offerId;
  const liveAttributes = await applyContentAttributeFixes(
    product.descriptionCategoryId,
    product.typeId,
    await getLiveOzonAttributes(offerId),
    {
      descriptionRu: product.descriptionRu,
      weightGrams: product.weightGrams,
      unitsInPack: product.unitsInPack,
      title: product.nameRu ?? product.name,
    },
  );
  const resendOldPrice = product.oldPrice ?? computeOldPrice(product.price);

  const { result } = await importProducts([
    {
      offer_id: offerId,
      // nameRu varsa onu kullan — yoksa Ozon Latin harfli isme "critical" hata verir. Bunu
      // resendetmeyi unutursak (product.name kullanırsak) daha önce çevrilmiş isim burada
      // sessizce İngilizce'ye geri döner.
      name: product.nameRu ?? product.name,
      price: product.price,
      old_price: resendOldPrice,
      min_price: product.price,
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
      attributes: buildAttributesPayload(liveAttributes, modelName),
    },
  ]);

  await prisma.product.update({
    where: { offerId },
    data: { images, oldPrice: resendOldPrice, importTaskId: result.task_id, status: "pending", lastError: null },
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
  // Model adı: modelGroup varsa o öncelikli; yoksa handle'ın kendisi kullanılıyor ki bu
  // resend, aynı handle'ın diğer varyantlarıyla Ozon'da halihazırda birleşmiş kartı
  // offerId'ye çevirip bozmasın (bkz. submitHandleToOzon'daki aynı düzeltme, 2026-08-03).
  const modelName = product.modelGroup?.name ?? product.shopifyHandle ?? offerId;
  const images = Array.isArray(product.images) ? (product.images as string[]) : [];

  // Kategori DEĞİŞMEDİYSE Ozon'daki güncel attribute'ları taban alıp üzerine yeni/değişen
  // değerleri yazıyoruz (aksi halde bu resend, formda gösterilmeyen ama daha önce Ozon'da
  // set edilmiş her attribute'u siler). Kategori değiştiyse eski attribute ID'leri yeni
  // kategoriye ait olmayabilir, o yüzden sadece bu durumda eski attribute'ları taşımıyoruz.
  const categoryUnchanged =
    product.descriptionCategoryId === input.descriptionCategoryId && product.typeId === input.typeId;
  const liveAttributes = categoryUnchanged ? await getLiveOzonAttributes(offerId) : [];

  const merged = new Map<number, ProductAttributeInput>();
  for (const attr of liveAttributes) merged.set(attr.id, attr);
  for (const attr of input.attributes) {
    if (attr.id === MODEL_NAME_ATTRIBUTE_ID) continue;
    merged.set(attr.id, attr);
  }
  const fixedAttributes = await applyContentAttributeFixes(
    input.descriptionCategoryId,
    input.typeId,
    Array.from(merged.values()),
    {
      descriptionRu: product.descriptionRu,
      weightGrams: product.weightGrams,
      unitsInPack: product.unitsInPack,
      title: product.nameRu ?? product.name,
    },
  );
  const resendOldPrice = product.oldPrice ?? computeOldPrice(product.price);

  const { result } = await importProducts([
    {
      offer_id: offerId,
      name: product.nameRu ?? product.name,
      price: product.price,
      old_price: resendOldPrice,
      min_price: product.price,
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
      attributes: buildAttributesPayload(fixedAttributes, modelName),
    },
  ]);

  await prisma.product.update({
    where: { offerId },
    data: {
      descriptionCategoryId: input.descriptionCategoryId,
      typeId: input.typeId,
      oldPrice: resendOldPrice,
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
