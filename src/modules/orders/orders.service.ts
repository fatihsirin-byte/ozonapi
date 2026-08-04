import { prisma } from "../../db/prisma";
import { listFbsPostings, type OzonFbsPosting } from "../../ozon/orders";
import { getProductAttributes } from "../../ozon/products";
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
        const product = await prisma.product.findUnique({ where: { offerId: item.offer_id } });
        await prisma.orderItem.upsert({
          where: { orderId_offerId: { orderId: order.id, offerId: item.offer_id } },
          create: {
            orderId: order.id,
            productId: product?.id,
            offerId: item.offer_id,
            quantity: item.quantity,
            price: item.price,
          },
          update: {
            productId: product?.id,
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

export async function listOrders(params: { status?: string; scheme?: string; since?: Date; to?: Date; skip?: number; take?: number }) {
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.scheme ? { scheme: params.scheme } : {}),
    ...(params.since || params.to
      ? { orderDate: { ...(params.since ? { gte: params.since } : {}), ...(params.to ? { lte: params.to } : {}) } }
      : {}),
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
    return result;
  } catch {
    return null; // henüz fatura yüklenmemiş
  }
}

export async function removeOzonInvoice(postingNumber: string) {
  await deleteInvoice(postingNumber);
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
