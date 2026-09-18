import { prisma } from "../../db/prisma";
import { listReturns, type OzonReturnItem } from "../../ozon/returns";
import { listRfbsReturns, type OzonRfbsReturnItem } from "../../ozon/rfbsReturns";

// Kullanıcı talebi (2026-09-18): "iade/iptaller için sayfa yapalım, hangilerinin maliyeti
// silindi (imha edildi), hangileri bizden bedel almadan kapandı (Ozon tazminat ödedi) anlaşılmıyor,
// panelde kafam karışıyor" — bu servis Ozon'un /v1/returns/list uç noktasından çektiği ham veriyi
// 3 nete kategoriye ayırıyor (bkz. classifyReturn):
//   - compensated: Ozon bize tazminat ödemiş, bize hiç maliyet çıkmamış (hatta kazanç).
//   - utilized: ürün imha edilmiş — hem ürünü hem saklama+imha bedelini kaybettik, GERÇEK maliyet.
//   - plain: ürün güvenle iade/iade sürecinde, imha ya da tazminat yok — en fazla saklama ücreti var.
export type ReturnCategory = "compensated" | "utilized" | "plain";

export interface ClassifiedReturn {
  id: string;
  postingNumber: string;
  offerId: string | null;
  productName: string | null;
  quantity: number | null;
  reasonName: string | null;
  type: string | null;
  schema: string | null;
  statusName: string | null;
  statusChangedAt: Date | null;
  storageFee: number | null;
  utilizationFee: number | null;
  currency: string | null;
  compensatedAt: Date | null;
  category: ReturnCategory;
  // Bu satırın bize gerçek maliyeti (RUB) — utilized ise storageFee+utilizationFee, diğerlerinde
  // sadece storageFee (varsa), compensated'de her zaman 0.
  costToUs: number;
}

export function classifyReturn(r: {
  storageFee: number | null;
  utilizationFee: number | null;
  compensatedAt: Date | null;
}): { category: ReturnCategory; costToUs: number } {
  const storageFee = r.storageFee ?? 0;
  const utilizationFee = r.utilizationFee ?? 0;
  if (r.compensatedAt) {
    return { category: "compensated", costToUs: 0 };
  }
  if (utilizationFee > 0) {
    return { category: "utilized", costToUs: storageFee + utilizationFee };
  }
  return { category: "plain", costToUs: storageFee };
}

function toClassified(row: {
  id: string;
  postingNumber: string;
  offerId: string | null;
  productName: string | null;
  quantity: number | null;
  reasonName: string | null;
  type: string | null;
  schema: string | null;
  statusName: string | null;
  statusChangedAt: Date | null;
  storageFee: number | null;
  utilizationFee: number | null;
  currency: string | null;
  compensatedAt: Date | null;
}): ClassifiedReturn {
  const { category, costToUs } = classifyReturn(row);
  return { ...row, category, costToUs };
}

// Ozon'dan verilen tarih aralığındaki tüm iadeleri çekip OzonReturn tablosuna upsert eder.
// operation_id gibi bir idempotentlik anahtarı zaten var (return'ün kendi id'si) — bu yüzden
// FinanceTransaction'ın aksine silip-yeniden-yazmaya gerek yok, doğrudan upsert ediliyor.
export async function syncReturns(params: { since: Date; to: Date }): Promise<number> {
  const timeFrom = params.since.toISOString();
  const timeTo = params.to.toISOString();
  let lastId = 0;
  let hasNext = true;
  let total = 0;
  // Güvenlik supabı — Ozon'un has_next'i yanlışlıkla hep true dönmesi ihtimaline karşı
  // sonsuz döngüye girmesin diye (500 sayfa = 250.000 kayıt, gerçekçi üst sınırın çok üstünde).
  let pageGuard = 0;

  while (hasNext && pageGuard < 500) {
    pageGuard++;
    const res = await listReturns({ timeFrom, timeTo, lastId, limit: 500 });
    const items = res.returns ?? [];
    for (const item of items) {
      await upsertReturn(item);
      total++;
    }
    hasNext = res.has_next && items.length > 0;
    if (items.length > 0) {
      const lastItemId = Number(items[items.length - 1].id);
      lastId = Number.isFinite(lastItemId) ? lastItemId : lastId;
    }
  }

  return total;
}

async function upsertReturn(item: OzonReturnItem): Promise<void> {
  const storagePrice = item.storage?.sum?.price != null ? Number(item.storage.sum.price) : null;
  const utilizationPrice = item.storage?.utilization_sum?.price != null ? Number(item.storage.utilization_sum.price) : null;
  const currency = item.storage?.sum?.currency_code ?? item.storage?.utilization_sum?.currency_code ?? item.product?.price?.currency_code ?? null;
  const compensatedAt = item.logistic?.cancelled_with_compensation_moment
    ? new Date(item.logistic.cancelled_with_compensation_moment)
    : null;
  const statusChangedAt = item.visual?.change_moment ? new Date(item.visual.change_moment) : null;

  const data = {
    postingNumber: item.posting_number,
    offerId: item.product?.offer_id ?? null,
    productName: item.product?.name ?? null,
    quantity: item.product?.quantity ?? null,
    reasonName: item.return_reason_name ?? null,
    type: item.type ?? null,
    schema: item.schema ?? null,
    statusName: item.visual?.status?.display_name ?? null,
    statusChangedAt,
    storageFee: storagePrice,
    utilizationFee: utilizationPrice,
    currency,
    compensatedAt,
    rawPayload: item as object,
    syncedAt: new Date(),
  };

  await prisma.ozonReturn.upsert({
    where: { id: String(item.id) },
    create: { id: String(item.id), ...data },
    update: data,
  });
}

export interface ReturnsSummary {
  totalCount: number;
  compensatedCount: number;
  utilizedCount: number;
  plainCount: number;
  totalCostToUs: number;
  totalStorageFees: number;
  totalUtilizationFees: number;
}

export async function getReturnsForRange(params: { since: Date; to: Date }): Promise<ClassifiedReturn[]> {
  const rows = await prisma.ozonReturn.findMany({
    where: { statusChangedAt: { gte: params.since, lte: params.to } },
    orderBy: { statusChangedAt: "desc" },
  });
  return rows.map(toClassified);
}

export function summarizeReturns(returns: ClassifiedReturn[]): ReturnsSummary {
  const summary: ReturnsSummary = {
    totalCount: returns.length,
    compensatedCount: 0,
    utilizedCount: 0,
    plainCount: 0,
    totalCostToUs: 0,
    totalStorageFees: 0,
    totalUtilizationFees: 0,
  };
  for (const r of returns) {
    if (r.category === "compensated") summary.compensatedCount++;
    else if (r.category === "utilized") summary.utilizedCount++;
    else summary.plainCount++;
    summary.totalCostToUs += r.costToUs;
    summary.totalStorageFees += r.storageFee ?? 0;
    summary.totalUtilizationFees += r.utilizationFee ?? 0;
  }
  return summary;
}

// rFBS iade/imha kayıtları (bkz. src/ozon/rfbsReturns.ts) — bu hesabın GERÇEK veri kaynağı.
// /v2/returns/rfbs/list toplu, tarih filtresiz dönüyor (hesap küçük); sayfalama yine de last_id
// ile güvence altına alınıyor.
export async function syncRfbsReturns(): Promise<number> {
  let lastId = 0;
  let total = 0;
  let pageGuard = 0;
  while (pageGuard < 200) {
    pageGuard++;
    const res = await listRfbsReturns({ lastId, limit: 500 });
    const items = res.returns ?? [];
    for (const item of items) {
      await upsertRfbsReturn(item);
      total++;
    }
    if (items.length < 500) break;
    lastId = items[items.length - 1].return_id;
  }
  return total;
}

async function upsertRfbsReturn(item: OzonRfbsReturnItem): Promise<void> {
  const data = {
    postingNumber: item.posting_number,
    orderNumber: item.order_number ?? null,
    offerId: item.product?.offer_id ?? null,
    productName: item.product?.name ?? null,
    price: item.product?.price ?? null,
    currency: item.product?.currency_code ?? null,
    stateCode: item.state?.state ?? null,
    stateName: item.state?.state_name ?? null,
    groupState: item.state?.group_state ?? null,
    moneyReturnStateName: item.state?.money_return_state_name || null,
    createdAt: item.created_at ? new Date(item.created_at) : null,
    rawPayload: item as object,
    syncedAt: new Date(),
  };
  await prisma.ozonRfbsReturn.upsert({
    where: { id: String(item.return_id) },
    create: { id: String(item.return_id), ...data },
    update: data,
  });
}

// "utilization" = ürün imha edildi (gerçek kayıp: ürün + saklama). "approved" +
// moneyReturnStateName doluysa müşteriye para iade edilmiş/tazminat ödenmiş (gerçek kayıp: satış
// bedeli). "price" alanı Ozon'un verdiği SATIŞ bedeli; gerçek maliyet kaybı için ayrıca
// Product.costPrice (bizim ürünü alış fiyatımız, USD — bkz. src/pricing/formula.ts, aynı birimle
// kullanılıyor) offerId üzerinden eşleniyor (2026-09-18, kullanıcı talebi: "ürünün bana maliyetini
// de yaz, şeffafça bilelim"). Ürün artık katalogda yoksa/costPrice hiç girilmemişse costPrice null
// kalır — panelde bu satırlar "maliyet bilinmiyor" olarak ayrı gösteriliyor, sessizce 0 sayılmıyor.
export type RfbsReturnCategory = "utilized" | "refunded" | "other";

export interface ClassifiedRfbsReturn {
  id: string;
  postingNumber: string;
  offerId: string | null;
  productName: string | null;
  price: number | null;
  costPrice: number | null;
  currency: string | null;
  stateName: string | null;
  createdAt: Date | null;
  category: RfbsReturnCategory;
}

// moneyReturnStateName alanı Ozon'dan HEP boş geliyor (canlıda doğrulandı, 2026-09-18) — para
// iadesi/tazminat kayıtları aslında groupState="approved" + stateCode="MoneyReturned" ya da
// "PartialCompensationReturnedByOzon" ile geliyor, o yüzden asıl ayrım groupState üzerinden.
function classifyRfbsReturn(r: { groupState: string | null }): RfbsReturnCategory {
  if (r.groupState === "utilization") return "utilized";
  if (r.groupState === "approved") return "refunded";
  return "other";
}

export async function getRfbsReturnsForRange(params: { since: Date; to: Date }): Promise<ClassifiedRfbsReturn[]> {
  const rows = await prisma.ozonRfbsReturn.findMany({
    where: { createdAt: { gte: params.since, lte: params.to } },
    orderBy: { createdAt: "desc" },
  });
  const offerIds = [...new Set(rows.map((r) => r.offerId).filter((v): v is string => !!v))];
  const products = offerIds.length
    ? await prisma.product.findMany({ where: { offerId: { in: offerIds } }, select: { offerId: true, costPrice: true } })
    : [];
  const costByOfferId = new Map(products.map((p) => [p.offerId, p.costPrice != null ? Number(p.costPrice) : null]));

  return rows.map((r) => ({
    id: r.id,
    postingNumber: r.postingNumber,
    offerId: r.offerId,
    productName: r.productName,
    price: r.price,
    costPrice: r.offerId ? costByOfferId.get(r.offerId) ?? null : null,
    currency: r.currency,
    stateName: r.stateName,
    createdAt: r.createdAt,
    category: classifyRfbsReturn(r),
  }));
}

export interface RfbsReturnsSummary {
  totalCount: number;
  utilizedCount: number;
  utilizedValue: number;
  refundedCount: number;
  refundedValue: number;
  // Gerçek maliyet kaybı (USD) — sadece costPrice bilinen satırlar toplanıyor.
  totalCostLost: number;
  // costPrice bulunamayan (ürün katalogda yok ya da hiç maliyet girilmemiş) satır sayısı —
  // totalCostLost'un GERÇEKTE olduğundan düşük görünebileceğini panelde açıkça belirtmek için.
  unknownCostCount: number;
}

export function summarizeRfbsReturns(rows: ClassifiedRfbsReturn[]): RfbsReturnsSummary {
  const summary: RfbsReturnsSummary = {
    totalCount: rows.length,
    utilizedCount: 0,
    utilizedValue: 0,
    refundedCount: 0,
    refundedValue: 0,
    totalCostLost: 0,
    unknownCostCount: 0,
  };
  for (const r of rows) {
    const price = r.price ?? 0;
    if (r.category === "utilized") {
      summary.utilizedCount++;
      summary.utilizedValue += price;
    } else if (r.category === "refunded") {
      summary.refundedCount++;
      summary.refundedValue += price;
    }
    if (r.category === "utilized" || r.category === "refunded") {
      if (r.costPrice != null && !Number.isNaN(r.costPrice)) {
        summary.totalCostLost += r.costPrice;
      } else {
        summary.unknownCostCount++;
      }
    }
  }
  return summary;
}

// "Kaybolan tutar" sorusunun ikinci yarısı — sevkiyattan önce iptal edilen siparişler. Bunlar
// için ayrı bir Ozon senkronizasyonuna gerek yok, zaten Order tablosunda status="cancelled" olarak
// duruyor (bkz. syncFbsOrders). Ürün hiç yola çıkmadığı için normalde bize gerçek bir maliyet
// çıkmaz — sadece bilgi amaçlı, "bu kadar tutarlık sipariş iptal oldu" diye gösteriliyor.
export async function getCancelledOrdersSummary(params: { since: Date; to: Date }) {
  const cancelled = await prisma.order.findMany({
    where: { status: "cancelled", orderDate: { gte: params.since, lte: params.to } },
    include: { items: true },
  });
  let totalAmount = 0;
  for (const o of cancelled) {
    for (const it of o.items) {
      totalAmount += Number(it.price) * it.quantity;
    }
  }
  return { count: cancelled.length, totalAmount };
}
