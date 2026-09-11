import { prisma } from "../../db/prisma";
import { listFbsPostings, getFbsPosting, shipFbsPosting, setMultiBoxQty, type OzonFbsPosting } from "../../ozon/orders";
import { getProductAttributes } from "../../ozon/products";
import { OzonApiError } from "../../ozon/client";
import { importFromOzon, syncMissingProductsFromOzon } from "../products/products.service";
import { computePriceBreakdown } from "../../pricing/formula";
import { effectiveCargoWeightGrams, estimateShippingForWeight } from "../finance/pnl-report.service";
import {
  uploadInvoiceFile,
  createOrUpdateInvoice,
  getInvoice,
  deleteInvoice,
  getEtgbDeclarations,
  type OzonHsCode,
} from "../../ozon/invoices";

// Ozon'un kategori formunda GTİP için İKİ attribute var: 22992 "GTİP Kodu" serbest metin (kullanıcı
// kodu zaten biliyorsa), 22232 "AEB'nin GTİP kodları" ise GERÇEK aranabilir bir sözlük (Rusça arama
// terimleriyle, örn. "кондитерские") — kullanıcı kodu bilmiyorsa asıl kullanacağı alan bu. Sözlük
// değeri "1704901000 - Кондитерские изделия..." formatında geliyor, biz sadece baştaki kodu alıyoruz.
const GTIP_FREE_TEXT_ATTRIBUTE_ID = 22992;
const GTIP_DICTIONARY_ATTRIBUTE_ID = 22232;

function extractGtipCode(rawValue: string): string {
  const match = rawValue.match(/^\d{6,12}/);
  return match ? match[0] : rawValue.trim();
}

// Ozon'daki siparişleri (ve kalemlerini) çekip local DB'ye upsert eder, durum/PNL takibi için kullanılır.
export async function syncFbsOrders(params: { since: string; to: string; status?: string }) {
  let offset = 0;
  const limit = 100;
  let hasNext = true;
  const synced: OzonFbsPosting[] = [];

  while (hasNext) {
    const { result } = await listFbsPostings({ ...params, offset, limit });

    for (const posting of result.postings) {
      // Bazı posting'lerde (örn. aggregator akışı) order_date boş/geçersiz geliyor — bu durumda
      // in_process_at'e düşüyoruz, o da yoksa alanı boş bırakıyoruz (upsert'in patlamaması için).
      const rawDate = posting.order_date || posting.in_process_at;
      const parsedDate = rawDate ? new Date(rawDate) : null;
      const orderDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

      const order = await prisma.order.upsert({
        where: { postingNumber: posting.posting_number },
        create: {
          postingNumber: posting.posting_number,
          status: posting.status,
          scheme: "fbs",
          orderDate,
          rawPayload: posting as unknown as object,
        },
        update: {
          status: posting.status,
          rawPayload: posting as unknown as object,
        },
      });

      for (const item of posting.products ?? []) {
        let product = await prisma.product.findUnique({ where: { offerId: item.offer_id } });
        // Ürün panelden değil, doğrudan Ozon'un kendi arayüzünden açıldıysa bizim DB'mizde hiç
        // kaydı olmuyor — görsel/isim panelde boş kalıyordu. Bu durumda Ozon'dan aynı
        // importFromOzon() ile (bkz. products.service.ts, "Ozon'dan içe aktar" butonuyla aynı
        // mantık) canlı ürün bilgisini çekip otomatik bir Product kaydı açıyoruz (2026-08-24,
        // kullanıcı talebi). costPrice bilinmediği için boş kalır — kâr hesabı bunu bekleyene
        // kadar "bilinmiyor" döner, sipariş senkronizasyonunu engellemez.
        if (!product) {
          try {
            product = await importFromOzon(item.offer_id);
          } catch (error) {
            console.error(`[syncFbsOrders] ${item.offer_id} Ozon'dan otomatik içe aktarılamadı:`, error);
          }
        }
        await prisma.orderItem.upsert({
          where: { orderId_offerId: { orderId: order.id, offerId: item.offer_id } },
          create: {
            orderId: order.id,
            productId: product?.id,
            offerId: item.offer_id,
            ozonSku: item.sku != null ? BigInt(item.sku) : null,
            quantity: item.quantity,
            price: item.price,
          },
          update: {
            productId: product?.id,
            ozonSku: item.sku != null ? BigInt(item.sku) : null,
            quantity: item.quantity,
            price: item.price,
          },
        });
      }

      synced.push(posting);
    }

    hasNext = result.has_next;
    offset += limit;
  }

  // Ozon panelinden doğrudan açılmış, henüz hiçbir siparişe düşmemiş ürünleri de yakalamak için —
  // bir siparişi beklemeden, her senkronizasyonda tam katalog taraması yapılır (2026-09-09,
  // kullanıcı talebi). Bu adım başarısız olursa sipariş senkronizasyonunu engellemesin diye ayrı try/catch.
  try {
    const { checked, imported } = await syncMissingProductsFromOzon();
    if (imported > 0) {
      console.log(`[syncFbsOrders] Ozon kataloğu tarandı (${checked} ürün), ${imported} yeni ürün içeri alındı`);
    }
  } catch (error) {
    console.error("[syncFbsOrders] Ozon katalog taraması başarısız:", error);
  }

  return synced;
}

// Ozon'un komisyon/kargo kesintilerini muhasebeleştirmesini beklemeye gerek yok — satış fiyatı
// zaten posting.products[].price içinde sipariş anında geliyor, bunu OrderItem'da saklıyoruz.
export function computeOrderAmount(items: Array<{ price: string; quantity: number }>): number {
  return items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
}

// Alış fiyatı (costPrice) olmadan kâr hesaplanamaz — ürün eşleşmemişse (product null) ya da
// costPrice hiç girilmemişse null döner (0 değil, "bilinmiyor" ile "kâr sıfır" karışmasın diye).
export function computeOrderCost(items: Array<{ quantity: number; product: { costPrice: string | null } | null }>): number | null {
  let total = 0;
  for (const item of items) {
    const cost = item.product?.costPrice;
    if (cost == null) return null;
    total += Number(cost) * item.quantity;
  }
  return total;
}

interface EstimatedProfitItem {
  price: string;
  quantity: number;
  product: {
    costPrice: string | null;
    weightGrams: number | null;
    cargoWeightGrams: number | null;
    widthCm: number | null;
    heightCm: number | null;
    depthCm: number | null;
    heavyPackaging: boolean;
  } | null;
}

// Siparişler listesinde "Olası Net Kâr" sütunu için (2026-09-10, kullanıcı talebi: "tahmini
// ağırlıktan tahmini kargo, komisyon vs."). "Fiyat Hesaplayıcı"nın da kullandığı
// computePriceBreakdown ile aynı formülü (ağırlık paketleme payı + kademeli kargo tarifesi + Ozon
// komisyonu + lojistik hizmet bedeli + banka işlem ücreti) satılan GERÇEK fiyat üzerinden kalem
// kalem uyguluyor. Ozon bu siparişin kargo kesintisini GERÇEKTEN işlediyse (realShippingUsd —
// bkz. pnl-report.service.ts getRealShippingAndFeesUsdByPosting), tahmini ağırlık bazlı kargo
// yerine o kullanılır (2026-09-10, kullanıcı talebi: "faturası kesildiyse ... bunlardan yararlan
// kargo fiyatında") — komisyon/lojistik/banka bedeli her zaman satış fiyatı üzerinden hesaplanmaya devam eder.
// realFeesUsd verilirse (Ozon'un GERÇEK komisyon+diğer kesintileri, bkz. pnl-report.service.ts
// getRealShippingAndFeesUsdByPosting) tahmini sabit oran (%5 komisyon + %2 lojistik + %1.9 banka)
// yerine kullanılır — realShippingUsd'nin kargoda yaptığının aynısı (2026-09-11, kullanıcı talebi:
// "komisyon banka gideri iç dağıtım vs düşmüyor" — aslında düşülüyordu ama SABİT TAHMİNİ oranla;
// Ozon'un gerçekte kestiği tutar bu hesaba hiç yansımıyordu).
export function computeOrderEstimatedProfit(
  items: EstimatedProfitItem[],
  realShippingUsd?: number | null,
  realFeesUsd?: number | null,
): number | null {
  // Kalemsiz bir sipariş için hesaplanacak bir şey yok — bu koruma olmadan aşağıdaki tarife
  // formülü 0 gram için bile sabit taban ücreti (ör. -$0.80) döndürüp "kalemsiz sipariş zararda"
  // gibi hayalet bir rakam gösterirdi (2026-09-10'da code review'da tespit edildi).
  if (items.length === 0) return null;

  let totalSaleMinusCost = 0;
  let totalEstimatedFeesUsd = 0;
  let totalBillingWeightGrams = 0;
  let anyWeightMissing = false;

  for (const item of items) {
    const product = item.product;
    if (!product?.costPrice) return null;
    const breakdown = computePriceBreakdown(
      product.costPrice,
      product.weightGrams,
      { widthCm: product.widthCm, heightCm: product.heightCm, depthCm: product.depthCm },
      Number(item.price),
      product.heavyPackaging,
      product.cargoWeightGrams,
    );
    if (!breakdown) return null;
    // Kargo hariç, satış - alış kısmı adet bazında doğrusal ölçekleniyor, bu yüzden quantity ile
    // çarpılabilir. Tahmini komisyon/lojistik/banka bedeli AYRI tutuluyor (breakdown.profitUsd
    // zaten bunları düşmüş haliyle geliyordu — actualPrice - shipping - cost - profit = tahmini
    // ücret olarak geri çıkarılıyor) ki realFeesUsd verildiğinde onun yerine konabilsin.
    totalSaleMinusCost += (breakdown.actualPriceUsd - breakdown.costUsd) * item.quantity;
    const estimatedFeeUsd = breakdown.actualPriceUsd - breakdown.shippingUsd - breakdown.costUsd - breakdown.profitUsd;
    totalEstimatedFeesUsd += estimatedFeeUsd * item.quantity;

    // ÖNEMLİ: kargo tarifesinin sabit taban ücreti (ör. $0.80) paket başına BİR KEZ uygulanır —
    // birim ağırlığı quantity ile çarpıp tarifeyi TEK SEFERDE toplam ağırlığa uyguluyoruz, aksi
    // halde (computePriceBreakdown'ın birim bazlı shippingUsd'sini quantity ile çarpmak gibi) taban
    // ücret adet sayısı kadar tekrarlanıp kargo maliyeti olduğundan yüksek çıkardı (2026-09-10'da
    // code review'da tespit edildi — pnl-report.service.ts'teki 2026-08-24 tarihli aynı düzeltmeyle
    // tutarlı: "kalemlerin toplam ağırlığı TEK SEFERDE formüle uygulanıyor"). Ağırlık "var mı" kararı
    // için effectiveCargoWeightGrams KULLANILIYOR — sipariş detay sayfasındaki bitişik "Tahmini
    // Kargo" kartı da AYNI fonksiyonu kullanıyor; farklı bir kontrol (ör. computePriceBreakdown'ın
    // kendi içindeki falsy kontrolü) kullanmak weightGrams=0 olan nadir bir üründe aynı sayfadaki
    // iki kartın birbiriyle ÇELİŞMESİNE yol açıyordu (2026-09-10'da code review'da tespit edildi).
    const unitBillingWeight = effectiveCargoWeightGrams(product);
    if (unitBillingWeight == null) {
      anyWeightMissing = true;
    } else {
      totalBillingWeightGrams += unitBillingWeight * item.quantity;
    }
  }

  const feesUsd = realFeesUsd ?? totalEstimatedFeesUsd;

  if (realShippingUsd != null) return totalSaleMinusCost - feesUsd - realShippingUsd;
  // totalBillingWeightGrams <= 0 burada ARTIK engel değil — tüm kalemlerin ağırlığı gerçekten
  // (cargoWeightGrams olarak) 0 girilmişse bu geçerli bir veridir, "bilinmiyor" değil; sadece
  // anyWeightMissing (gerçekten hiç veri yoksa) null döndürülmeli (2026-09-10'da code review'da
  // tespit edildi — önceki davranış bu durumda geçerli bir kâr rakamı dönerken bu engel "-" gösterip gerileme yaratıyordu).
  if (anyWeightMissing) return null;
  // pnl-report.service.ts'teki estimateShippingForWeight KULLANILIYOR (formula.ts'teki
  // estimateShippingCostUsd DEĞİL) — sipariş detay sayfasındaki bitişik "Tahmini Kargo" kartı da
  // bu fonksiyonu kullanıyor; aynı formül iki ayrı dosyada tekrar bakımlı kalırsa biri değişip
  // diğeri değişmeyince aynı sayfada iki kart çelişebilirdi (2026-09-10'da code review'da tespit
  // edildi). İkisi şu an birebir aynı formül, sadece TEK yerden geliyor olması garanti ediliyor.
  return totalSaleMinusCost - feesUsd - estimateShippingForWeight(totalBillingWeightGrams);
}

// Sipariş arama kutusu (2026-09-09, kullanıcı talebi): müşteri adı, Ozon sipariş no, ürün SKU'su
// (Ozon'un numerik ürün kimliği), ürün adı ve offerId'nin hepsinde birden arar. NOT: sistemde
// hiçbir yerde gerçek "barkod" (EAN/UPC) verisi saklanmıyor — Ozon'un posting API'sinde de böyle
// bir alan gelmiyor (yalnızca kargo paketi için ayrı bir "barcodes" alanı var, ürünle ilgisiz) —
// bu yüzden barkod araması kapsam dışı, kullanıcıya ayrıca belirtildi.
//
// ham SQL kullanılıyor çünkü Prisma'nın JSON path filtreleri (müşteri adı rawPayload içinde
// gömülü) "mode: insensitive" desteklemiyor (2026-09-09'da code review'da tespit edildi) — ILIKE
// tüm alanlarda tutarlı büyük/küçük harf duyarsız arama sağlıyor. asSku'yu 18 haneyle sınırlamak
// da Postgres bigint taşmasını (ve sayfanın çökmesini) önlüyor (aynı incelemede tespit edildi).
export async function findSearchMatchingOrderIds(search: string): Promise<string[]> {
  const trimmed = search.trim();
  // ILIKE'ın kendi joker karakterlerini (%, _) ve kaçış karakterini (\) literal arıyormuş gibi
  // kaçırıyoruz — aksi halde offerId/SKU'larda yaygın olan "_" tek karakterlik joker gibi
  // davranıp alakasız sonuçlar da eşleşiyordu (2026-09-10'da code review'da tespit edildi).
  const escaped = trimmed.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  // asSku metin dışı bir arama için null olabiliyor — Postgres, parametre NULL geldiğinde
  // "ozonSku" sütununun tipini (bigint) çıkaramıyor ve "could not determine data type of
  // parameter" hatasıyla çöküyordu (2026-09-10'da canlıda arama yapılınca tespit edildi) —
  // bu yüzden aşağıda her iki kullanımda da ::bigint ile açıkça belirtiliyor.
  const asSku = /^\d{1,18}$/.test(trimmed) ? BigInt(trimmed) : null;

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT o.id
    FROM "Order" o
    LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
    LEFT JOIN "Product" p ON p.id = oi."productId"
    WHERE o."postingNumber" ILIKE ${pattern}
       OR (o."rawPayload" -> 'customer' ->> 'name') ILIKE ${pattern}
       OR (o."rawPayload" -> 'addressee' ->> 'name') ILIKE ${pattern}
       OR oi."offerId" ILIKE ${pattern}
       OR p."name" ILIKE ${pattern}
       OR p."nameRu" ILIKE ${pattern}
       OR (${asSku}::bigint IS NOT NULL AND oi."ozonSku" = ${asSku}::bigint)
  `;
  return rows.map((r) => r.id);
}

function matchingIdsWhere(matchingIds: string[] | null) {
  return matchingIds !== null ? { id: { in: matchingIds } } : {};
}

export async function listOrders(params: {
  status?: string;
  scheme?: string;
  since?: Date;
  to?: Date;
  invoicedSince?: Date;
  invoicedTo?: Date;
  // Arama sonucu eşleşen sipariş id'leri — çağıran taraf (app/orders/page.tsx) bunu tek seferde
  // hesaplayıp hem burada hem getOrderFilterCounts'ta kullanıyor; aksi halde aynı pahalı ILIKE
  // sorgusu (findSearchMatchingOrderIds) sayfa başına iki kez çalışırdı (2026-09-10'da code
  // review'da tespit edildi).
  matchingIds?: string[] | null;
  skip?: number;
  take?: number;
}) {
  const matchingIds = params.matchingIds ?? null;
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.scheme ? { scheme: params.scheme } : {}),
    ...(params.since || params.to
      ? { orderDate: { ...(params.since ? { gte: params.since } : {}), ...(params.to ? { lte: params.to } : {}) } }
      : {}),
    ...(params.invoicedSince || params.invoicedTo
      ? {
          parasutInvoicedAt: {
            ...(params.invoicedSince ? { gte: params.invoicedSince } : {}),
            ...(params.invoicedTo ? { lt: params.invoicedTo } : {}),
          },
        }
      : {}),
    ...matchingIdsWhere(matchingIds),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { items: { include: { product: true } } },
      orderBy: { orderDate: "desc" },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total };
}

// Siparişler sayfasındaki filtre butonlarının (Tümü / durum / Bugün Faturası Kesilenler) içine adet
// yazmak için — arama kutusundaki metin sabit tutulup (kullanıcı bir şey ararken butonlar da o arama
// içindeki dağılımı göstersin diye "cascade") her buton kendi filtresiyle ayrı ayrı sayılıyor.
export async function getOrderFilterCounts(params: {
  matchingIds?: string[] | null;
  invoicedSince: Date;
  invoicedTo: Date;
}) {
  const matchingIds = params.matchingIds ?? null;
  const baseWhere = matchingIdsWhere(matchingIds);

  // "total" ayrı bir COUNT(*) yerine durum gruplarının toplamından türetiliyor — Order.status
  // zorunlu (non-nullable) bir alan olduğu için bu iki değer matematiksel olarak hep eşit, ayrı
  // sorgu sadece gereksiz bir DB gidiş-dönüşüydü (2026-09-10'da code review'da tespit edildi).
  const [statusGroups, invoicedToday] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
    prisma.order.count({
      where: { ...baseWhere, parasutInvoicedAt: { gte: params.invoicedSince, lt: params.invoicedTo } },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const g of statusGroups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }

  return { total, byStatus, invoicedToday };
}

// Toast bildirimleri için — bu tarihten SONRA bizim DB'ye düşen (createdAt, yani sync'in yeni
// fark ettiği) siparişleri kalem+ürün bilgisiyle döner. orderDate değil createdAt kullanılıyor
// çünkü amaç "gerçek sipariş anı" değil "panelin yeni fark ettiği an".
export async function getRecentOrders(since: Date) {
  return prisma.order.findMany({
    where: { createdAt: { gt: since } },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getOrderDetail(postingNumber: string) {
  const order = await prisma.order.findUnique({
    where: { postingNumber },
    include: { items: { include: { product: true } } },
  });
  if (!order) return null;

  // FinanceTransaction, Order'a FK ile bağlı değil (bkz. schema.prisma yorumu) — manuel join.
  const transactions = await prisma.financeTransaction.findMany({
    where: { postingNumber },
    orderBy: { operationDate: "desc" },
  });

  return { ...order, transactions };
}

// Kargo Kontrolü sekmesindeki checkbox'lar için — (postingNumber, offerId) ikilileriyle gelen
// kalemleri toplu olarak işaretler/işaretini kaldırır. OrderItem'ın gerçek unique anahtarı
// (orderId, offerId) olduğundan önce postingNumber -> orderId çözülüyor.
export async function setShippingReviewed(items: Array<{ postingNumber: string; offerId: string }>, reviewed: boolean) {
  const postingNumbers = [...new Set(items.map((i) => i.postingNumber))];
  const orders = await prisma.order.findMany({
    where: { postingNumber: { in: postingNumbers } },
    select: { id: true, postingNumber: true },
  });
  const orderIdByPosting = new Map(orders.map((o) => [o.postingNumber, o.id]));

  const offerIdsByOrderId = new Map<string, string[]>();
  for (const item of items) {
    const orderId = orderIdByPosting.get(item.postingNumber);
    if (!orderId) continue;
    const list = offerIdsByOrderId.get(orderId) ?? [];
    list.push(item.offerId);
    offerIdsByOrderId.set(orderId, list);
  }

  let updated = 0;
  for (const [orderId, offerIds] of offerIdsByOrderId) {
    const result = await prisma.orderItem.updateMany({
      where: { orderId, offerId: { in: offerIds } },
      data: { shippingReviewed: reviewed },
    });
    updated += result.count;
  }
  return updated;
}

// Bizim kendi takibimiz için — tedarikçiden aldığımız alış faturasının numarası, Ozon'a gitmiyor.
export async function updatePurchaseInvoiceNumber(postingNumber: string, purchaseInvoiceNumber: string | null) {
  return prisma.order.update({ where: { postingNumber }, data: { purchaseInvoiceNumber } });
}

// Sipariş kalemlerindeki ürünlerin GTİP kodunu (varsa) önerir — draftAttributes'ta yoksa ve
// ürün zaten Ozon'a gönderilmişse canlı attribute'lardan çeker. Fatura yükleme formunu
// otomatik doldurmak için; kullanıcı isterse üzerine yazabilir.
export async function suggestHsCodesForOrder(postingNumber: string): Promise<Record<string, string>> {
  const order = await getOrderDetail(postingNumber);
  if (!order) return {};

  const suggestions: Record<string, string> = {};
  const needLiveFetch: string[] = [];

  for (const item of order.items) {
    const draft = item.product?.draftAttributes as { attributes?: Array<{ id: number; value?: string }> } | null;
    const draftDictionary = draft?.attributes?.find((a) => a.id === GTIP_DICTIONARY_ATTRIBUTE_ID)?.value;
    const draftFreeText = draft?.attributes?.find((a) => a.id === GTIP_FREE_TEXT_ATTRIBUTE_ID)?.value;
    const draftValue = draftDictionary ?? draftFreeText;
    if (draftValue) {
      suggestions[item.offerId] = extractGtipCode(draftValue);
    } else if (item.product?.ozonProductId) {
      needLiveFetch.push(item.offerId);
    }
  }

  if (needLiveFetch.length > 0) {
    try {
      const { result } = await getProductAttributes(needLiveFetch);
      for (const entry of result) {
        const dictionaryAttr = entry.attributes.find((a: { id: number }) => a.id === GTIP_DICTIONARY_ATTRIBUTE_ID);
        const freeTextAttr = entry.attributes.find((a: { id: number }) => a.id === GTIP_FREE_TEXT_ATTRIBUTE_ID);
        const value = dictionaryAttr?.values?.[0]?.value ?? freeTextAttr?.values?.[0]?.value;
        if (value) suggestions[entry.offer_id] = extractGtipCode(value);
      }
    } catch {
      // canlıdan çekilemedi — kullanıcı elle girer
    }
  }

  return suggestions;
}

export interface SubmitOzonInvoiceParams {
  postingNumber: string;
  fileBase64: string;
  number: string;
  date: string;
  price: number;
  priceCurrency: string;
  hsCodes: OzonHsCode[];
}

// Ozon'un TR→RU KDV iadesi/gümrük "proforma fatura" akışı — önce dosyayı yükleyip url alıyoruz,
// sonra bu url'i fatura bilgileriyle (no/tarih/tutar/GTİP) siparişe bağlıyoruz.
export async function submitOzonInvoice(params: SubmitOzonInvoiceParams) {
  const { url } = await uploadInvoiceFile({ postingNumber: params.postingNumber, base64Content: params.fileBase64 });
  await createOrUpdateInvoice({
    postingNumber: params.postingNumber,
    url,
    hsCodes: params.hsCodes,
    date: params.date,
    number: params.number,
    price: params.price,
    priceCurrency: params.priceCurrency,
  });
  return { url };
}

export async function fetchOzonInvoice(postingNumber: string) {
  try {
    const { result } = await getInvoice(postingNumber);
    // Ozon, hiç fatura yüklenmemiş olsa bile boş/varsayılan bir obje dönüyor
    // (file_url: "", date: null, price: 0) — gerçek bir fatura var mı yok mu, file_url'in
    // dolu olup olmadığına bakarak anlıyoruz, sadece result'un varlığına değil (2026-08-05'te
    // canlıda tespit edildi — "1.01.1970 — 0" olarak boş bir fatura gösteriliyordu).
    if (!result?.file_url) return null;
    return result;
  } catch {
    return null; // henüz fatura yüklenmemiş
  }
}

export async function removeOzonInvoice(postingNumber: string) {
  await deleteInvoice(postingNumber);
}

// shipFbsPosting'in ham cevabı beklenen `string[]` DEĞİL de eski/belgelenmemiş `{ posting_number:
// string[] }` şeklinde gelirse (bu satırlar hiç canlıda test edilmeden, sadece dokümantasyon
// araştırmasıyla yazıldı — bkz. BEKLEYEN-GELISTIRMELER.md #3) çökmesin diye savunmacı bir ayrıştırma
// — Ozon'a GERÇEK istek zaten gittikten SONRA bir ayrıştırma hatası yüzünden kilidin yanlışlıkla
// serbest bırakılıp çift sevkiyata yol açmaması için (2026-09-10'da code review'da tespit edildi).
function extractShippedPostingNumbers(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (raw && typeof raw === "object" && "posting_number" in raw) {
    const nested = (raw as { posting_number: unknown }).posting_number;
    if (Array.isArray(nested)) return nested.filter((x): x is string => typeof x === "string");
  }
  return [];
}

// shipOrder içinde iki ayrı yerden çağrılıyordu (2026-09-10'da code review'da tespit edildi) — tek
// yerden, kilidin serbest bırakılma mantığının ileride tutarsız güncellenmesini önlemek için.
function releaseShipClaim(postingNumber: string) {
  return prisma.order.updateMany({
    where: { postingNumber, shipClaimedAt: { not: null } },
    data: { shipClaimedAt: null },
  });
}

// Ozon panelindeki "Topla" ile aynı adım — siparişi awaiting_packaging'den bir sonraki duruma
// geçirir ve kargo etiketinin oluşmasını tetikler (bkz. BEKLEYEN-GELISTIRMELER.md #3, kullanıcı
// notu: etiket ANCAK bu adımdan sonra oluşuyor). multiBoxQty verilirse (Ozon panelinde bu seçenek
// sadece paketteki toplam ürün adedi 1'den fazlaysa çıkıyor — kullanıcı notu) shipFbsPosting'den
// ÖNCE setMultiBoxQty çağrılıyor; Ozon kendi tarafında ürünleri kutulara nasıl dağıtacağına karar
// veriyor, biz "kaç kutu" bilgisini veriyoruz (hangi ürünün hangi kutuya gideceğini DEĞİL).
export async function shipOrder(postingNumber: string, multiBoxQty?: number) {
  if (multiBoxQty != null && (!Number.isInteger(multiBoxQty) || multiBoxQty < 1)) {
    throw new Error("Geçersiz kutu sayısı — 1 ya da daha büyük bir tam sayı olmalı.");
  }

  const order = await prisma.order.findUnique({
    where: { postingNumber },
    include: { items: true },
  });
  if (!order) {
    throw new Error("Sipariş bulunamadı");
  }
  if (order.items.length === 0) {
    throw new Error("Bu siparişte hiç kalem yok — paketlenemez, önce siparişi yeniden senkronize edin.");
  }
  const missingSku = order.items.find((item) => item.ozonSku == null);
  if (missingSku) {
    throw new Error(
      `"${missingSku.offerId}" kaleminin Ozon SKU bilgisi eksik — bu siparişi güvenle paketleyemiyoruz, önce siparişi yeniden senkronize edin.`,
    );
  }

  // Kilit için BİLEREK "status" alanı DEĞİL, ayrı bir shipClaimedAt alanı kullanılıyor: 15
  // dakikada bir çalışan sync cron'u (syncFbsOrders) status'ü Ozon'dan gelen gerçek değerle EZİYOR
  // — kilit status'e yazılsaydı cron onu silip, çift tıklama korumasını devre dışı bırakabilirdi
  // (2026-09-10'da code review'da tespit edildi; Paraşüt fatura kilidi de aynı sebeple ayrı bir
  // alan — parasutInvoiceId — kullanıyor).
  const claim = await prisma.order.updateMany({
    where: { postingNumber, status: "awaiting_packaging", shipClaimedAt: null },
    data: { shipClaimedAt: new Date() },
  });
  if (claim.count === 0) {
    // order.status kilit denemesinden ÖNCE okunmuştu — kilidin neden başarısız olduğunu doğru
    // yansıtmıyordu (özellikle iki eşzamanlı istekte kaybeden isteğin hata mesajı yanıltıcı
    // oluyordu, 2026-09-10'da code review'da tespit edildi). Güncel satırı tekrar okuyoruz.
    const currentOrder = await prisma.order.findUnique({ where: { postingNumber } });
    throw new Error(
      `Bu sipariş "Topla" için uygun durumda değil (mevcut durum: ${currentOrder?.status ?? "bilinmiyor"}${currentOrder?.shipClaimedAt ? ", kilitli" : ""}) — ya zaten paketlenmiş, ya az önce başka bir istekle paketleniyor ya da önceki bir deneme belirsiz kaldı (Ozon panelinden kontrol edilmesi gerekiyor).`,
    );
  }

  // Kilit alındıktan SONRA kalemleri tekrar okuyoruz — sync cron'u (ya da elle "Senkronize Et")
  // ilk okuma ile burası arasında ozonSku/adet güncellemiş olabilir; Ozon'a gidecek gerçek istek
  // en güncel veriyle kurulmalı (2026-09-10'da code review'da tespit edildi).
  const freshItems = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  if (freshItems.length === 0) {
    await releaseShipClaim(postingNumber);
    throw new Error("Bu siparişte hiç kalem yok — paketlenemez, önce siparişi yeniden senkronize edin.");
  }
  const staleSku = freshItems.find((item) => item.ozonSku == null);
  if (staleSku) {
    await releaseShipClaim(postingNumber);
    throw new Error(`"${staleSku.offerId}" kaleminin Ozon SKU bilgisi eksik — sipariş paketlenmedi.`);
  }
  // BigInt -> Number dönüşümü, güvenli tam sayı sınırını (Number.MAX_SAFE_INTEGER) aşarsa sessizce
  // yuvarlanıp Ozon'a yanlış bir product_id gönderebilirdi (2026-09-10'da code review'da tespit
  // edildi) — Ozon SKU'ları pratikte çok daha küçük olsa da açıkça kontrol ediyoruz.
  const unsafeSku = freshItems.find((item) => item.ozonSku! > BigInt(Number.MAX_SAFE_INTEGER));
  if (unsafeSku) {
    await releaseShipClaim(postingNumber);
    throw new Error(`"${unsafeSku.offerId}" kaleminin Ozon SKU değeri beklenenden çok büyük — güvenle gönderilemiyor, sipariş paketlenmedi.`);
  }

  try {
    if (multiBoxQty != null && multiBoxQty > 1) {
      const { result: boxResult } = await setMultiBoxQty({ postingNumber, multiBoxQty });
      // Ozon'un cevap şekli (result.result) hiç canlıda doğrulanmadı — yanlışsa GERÇEKTEN kabul
      // edilmiş bir kutu sayısını "reddedildi" sanıp isteği burada durdurmak, isteği hiç
      // durdurmadan yanlış varsaymaktan daha güvenli (2026-09-10'da code review'da tespit edildi:
      // "!boxResult.result" nesnenin kendisi de olsa true çıkabiliyordu). Ham cevabı logluyoruz ki
      // ilk gerçek bölme denemesinde şekil farklı çıkarsa hemen görülüp düzeltilebilsin.
      console.log(`[shipOrder] ${postingNumber} setMultiBoxQty ham cevap:`, JSON.stringify(boxResult));
      if (boxResult?.result !== true) {
        throw new Error("Ozon'un kutu sayısını kabul edip etmediği doğrulanamadı — sipariş paketlenmedi, tekrar deneyebilirsiniz.");
      }
    }
  } catch (error) {
    // Buraya kadar Ozon'a GERÇEK bir ship isteği HİÇ gitmedi (setMultiBoxQty ayrı, geri alınabilir
    // bir çağrı) — kilidi güvenle serbest bırakabiliriz.
    await releaseShipClaim(postingNumber);
    throw error;
  }

  let shipResult: unknown;
  try {
    const response = await shipFbsPosting({
      postingNumber,
      packages: [
        {
          products: freshItems.map((item) => ({
            product_id: Number(item.ozonSku),
            quantity: item.quantity,
          })),
        },
      ],
    });
    shipResult = response.result;
    console.log(`[shipOrder] ${postingNumber} shipFbsPosting ham cevap:`, JSON.stringify(shipResult));
  } catch (shipError) {
    // shipFbsPosting'in KENDİSİ hata verdi — retry KAPALI olduğu için (bkz. ozonPost'taki
    // retry:false) isteğin Ozon'a ulaşıp ulaşmadığı BELİRSİZ. İlk yazımda burada hemen
    // getFbsPosting ile "hâlâ awaiting_packaging mi" diye bakıp kilidi ona göre serbest
    // bırakıyorduk — ama Ozon'un durum güncellemesi ANINDA olmuyor olabilir (bu dosyada başka
    // yerde de not edildiği gibi, etiket bile ship'ten "kısa süre sonra" oluşuyor); şipFbsPosting
    // aslında başarılı olmuş olsa bile hemen sorulan getFbsPosting hâlâ eski "awaiting_packaging"
    // değerini dönebilir ve kilit YANLIŞLIKLA serbest bırakılıp GERÇEK bir çift sevkiyata yol
    // açabilirdi (2026-09-10'da code review'da tespit edildi). Bu yüzden artık SADECE Ozon'un
    // isteği hiç İŞLEMEDİĞİNİ gösteren AÇIK bir doğrulama hatası (400 gibi bir client-error — Ozon
    // isteği senkron olarak, hiç işlemeden reddetti demektir) varsa kilit serbest bırakılıyor;
    // belirsiz her durumda (network hatası, 5xx, zaman aşımı) kilit BİLEREK kilitli bırakılıyor —
    // yanlış tarafta hata yapmak zorundaysak, güvenli taraf bu.
    // 409 (Conflict) bilerek dışarıda bırakıldı — bazı API'lerde bu kod "zaten işlenmiş/durum
    // çakışması" anlamına gelir, yani Ozon isteği aslında işlemiş OLABİLİR; o yüzden 409'u da
    // belirsiz sayıp kilidi kilitli bırakıyoruz (2026-09-10'da code review'da tespit edildi — ilk
    // yazımda tüm 4xx'ler körlemesine "kesin reddedildi" sayılıyordu).
    const definitelyRejectedByOzon =
      shipError instanceof OzonApiError &&
      shipError.status !== undefined &&
      shipError.status >= 400 &&
      shipError.status < 500 &&
      shipError.status !== 409;
    if (definitelyRejectedByOzon) {
      await releaseShipClaim(postingNumber);
    } else {
      console.error(
        `[shipOrder] ${postingNumber}: shipFbsPosting belirsiz bir hatayla başarısız oldu (Ozon'a isteğin ulaşıp ulaşmadığı bilinmiyor) — sipariş BİLEREK kilitli bırakıldı, Ozon panelinden elle kontrol edilmeli. Gerçekten paketlenmediyse bkz. src/scripts/clear-stuck-ship-claim.ts.`,
        shipError,
      );
    }
    throw shipError;
  }

  // shipFbsPosting hata FIRLATMADI — Ozon isteği kabul etti demektir. Buradan sonraki her şey
  // (cevabı yorumlama, local DB'yi güncelleme) best-effort'tur; hiçbiri kilidi geri almaz, hiçbiri
  // yukarı fırlatmaz (bir önceki denemede TAM BURADA bir ayrıştırma hatası kilidi yanlışlıkla
  // serbest bırakıyordu, 2026-09-10'da code review'da tespit edildi).
  const postingNumbers = extractShippedPostingNumbers(shipResult);
  try {
    // shipResult'un şeklinden bağımsız olarak (bkz. extractShippedPostingNumbers'ın açıklaması —
    // hiç canlıda test edilmedi) güncel durumu her zaman Ozon'dan BİZZAT doğruluyoruz; postingNumbers
    // dizisinin uzunluğuna/şekline körlemesine güvenip "awaiting_deliver" yazmıyoruz (2026-09-10'da
    // code review'da tespit edildi — Ozon boş/beklenmedik bir cevap dönerse gerçekte paketlenmemiş
    // bir siparişi "paketlendi" gibi göstermiş olurduk).
    try {
      const { result: fresh } = await getFbsPosting(postingNumber);
      if (fresh.status === "awaiting_packaging") {
        // Ozon'un durum güncellemesi ANINDA olmayabilir — ship'ten hemen sonra sorulan bu değer
        // hâlâ ESKİ (paketlenmeden önceki) durumu yansıtıyor olabilir. Bunu olduğu gibi yazarsak
        // GERÇEKTEN paketlenmiş bir siparişi yanlışlıkla "hâlâ awaiting_packaging" gösterip
        // shipClaimedAt kilidiyle birleşince kalıcı "kilitli" görünümüne yol açardı (2026-09-10'da
        // code review'da tespit edildi) — bu durumda ham/muhtemelen bayat veriyi YAZMIYORUZ,
        // aşağıdaki iyimser "awaiting_deliver" yedeğine düşüyoruz.
        console.log(`[shipOrder] ${postingNumber} paketlendi ama Ozon hâlâ eski durumu (awaiting_packaging) dönüyor — muhtemelen gecikme, iyimser değer yazılıyor`);
        await prisma.order.update({ where: { postingNumber }, data: { status: "awaiting_deliver" } });
      } else {
        await prisma.order.update({
          where: { postingNumber },
          data: { status: fresh.status, rawPayload: fresh as unknown as object },
        });
      }
    } catch (error) {
      console.error(`[shipOrder] ${postingNumber} paketlendi ama güncel durum çekilemedi:`, error);
      await prisma.order.update({ where: { postingNumber }, data: { status: "awaiting_deliver" } });
    }
    if (postingNumbers.length !== 1 || postingNumbers[0] !== postingNumber) {
      // Bölünmüş (ya da beklenmedik şekilli) cevap — yeni posting numaraları farklı olabilir,
      // kalem düzeyinde tam uzlaştırma sadece syncFbsOrders'ta var; bir sonraki cron turuna bırakılıyor.
      console.log(`[shipOrder] ${postingNumber} beklenmedik/bölünmüş sonuç: ${JSON.stringify(postingNumbers)} — tam uzlaştırma sync cron'da yapılacak`);
    }
  } catch (error) {
    console.error(`[shipOrder] ${postingNumber} paketlendi ama local durum güncellenemedi:`, error);
  }

  return { postingNumbers };
}

// ETGB salt-okunur — Ozon/kargo firması otomatik oluşturuyor, biz sadece siparişin tarihi
// etrafında bir aralık verip posting_number'a göre eşleşeni buluyoruz. Henüz oluşmamışsa
// (kargo süreci tamamlanmadıysa) null döner — bu bir hata değil, zamanla gelir.
export async function fetchEtgbForOrder(postingNumber: string, orderDate: Date | null) {
  const anchor = orderDate ?? new Date();
  const dateFrom = new Date(anchor.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const dateTo = new Date(anchor.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { result } = await getEtgbDeclarations({ dateFrom, dateTo });
    return result.find((r) => r.posting_number === postingNumber) ?? null;
  } catch {
    return null;
  }
}
