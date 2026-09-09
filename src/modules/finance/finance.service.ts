import { prisma } from "../../db/prisma";
import { getAccrualTypes, getAccrualsForPostings } from "../../ozon/finance";

// Ozon'un accrual_types sözlüğünde sabit id — "Вознаграждение за продажу" (satış komisyonu),
// eski API'deki sale_commission alanının doğrudan karşılığı (2026-09-09'da canlıda doğrulandı).
const SALE_COMMISSION_TYPE_ID = 69;
// Kargo/lojistikle ilgili accrual tiplerini isimden yakalıyoruz (Ozon'un İngilizce type name'leri
// stabil programatik kimlikler — ör. "RfbsGlobalDelivery", "LastMile", "Shipment", "Logistic").
// Bu store için gerçek kargo ücretinin RfbsGlobalDelivery (uluslararası teslimat) altında geldiği
// canlı veriyle doğrulandı; diğer teslimat şemalarında (rFBS yurt içi, FBO vb.) farklı bir tip
// devreye girebileceği için isim bazlı, tek bir sabit id yerine.
const DELIVERY_TYPE_NAME_PATTERN = /deliver|logistic|lastmile|shipment|crossdock/i;

const ACCRUAL_CHUNK_SIZE = 200; // Ozon'un /v1/finance/accrual/postings sınırı

async function classifyAccrualTypes(): Promise<Map<number, { name: string; isDelivery: boolean }>> {
  const { accrual_types } = await getAccrualTypes();
  const map = new Map<number, { name: string; isDelivery: boolean }>();
  for (const t of accrual_types) {
    map.set(t.id, { name: t.name, isDelivery: DELIVERY_TYPE_NAME_PATTERN.test(t.name) });
  }
  return map;
}

// Verilen postingNumber'lar için Ozon'dan güncel tahakkuk (accrual) satırlarını çekip DB'ye yazar.
// /v3/finance/transaction/list (eski, tarih aralığı bazlı) Ozon tarafından kapatıldığı için
// (bkz. schema.prisma yorumu) bunun yerine kullanılıyor — bu uç nokta posting_number bazlı
// çalışıyor, tarih aralığı almıyor. operation_id artık verilmediğinden idempotentlik upsert
// yerine: her senkronizasyonda ilgili posting'lerin eski satırları silinip yenileri yazılıyor.
export async function syncAccrualsForPostings(postingNumbers: string[]): Promise<number> {
  const uniquePostingNumbers = [...new Set(postingNumbers)];
  if (uniquePostingNumbers.length === 0) return 0;

  const typeMap = await classifyAccrualTypes();
  let total = 0;

  for (let i = 0; i < uniquePostingNumbers.length; i += ACCRUAL_CHUNK_SIZE) {
    const chunk = uniquePostingNumbers.slice(i, i + ACCRUAL_CHUNK_SIZE);
    const { posting_accruals } = await getAccrualsForPostings(chunk);

    const rows: Array<{
      postingNumber: string;
      operationType: string;
      operationDate: Date;
      amount: number;
      commissionAmount: number | null;
      deliveryCharge: number | null;
      otherCharges: number | null;
      currency: string;
      rawPayload: object;
    }> = [];

    for (const posting of posting_accruals) {
      for (const line of posting.accruals) {
        const info = typeMap.get(line.type_id);
        const isCommission = line.type_id === SALE_COMMISSION_TYPE_ID;
        const isDelivery = !isCommission && (info?.isDelivery ?? false);
        const amount = Number(line.accrued.amount);
        rows.push({
          postingNumber: posting.posting_number,
          operationType: info?.name ?? `type_${line.type_id}`,
          operationDate: new Date(line.accrual_date),
          amount,
          commissionAmount: isCommission ? amount : null,
          deliveryCharge: isDelivery ? amount : null,
          otherCharges: !isCommission && !isDelivery ? amount : null,
          currency: line.accrued.currency,
          rawPayload: line as unknown as object,
        });
        total += 1;
      }
    }

    // Silme ve yeniden yazma tek transaction'da — aradan bir hata/çökme geçerse (deploy restart,
    // DB hıçkırığı vb.) bu chunk'taki posting'ler satırsız kalmasın diye (2026-09-09, code review bulgusu).
    const deleteOp = prisma.financeTransaction.deleteMany({ where: { postingNumber: { in: chunk } } });
    if (rows.length > 0) {
      await prisma.$transaction([deleteOp, prisma.financeTransaction.createMany({ data: rows })]);
    } else {
      await deleteOp;
    }
  }

  return total;
}

// İsim korunuyor ki çağıran yerler (senkron API route'u, cron, export-pnl-csv script'i) değişmesin
// — artık verilen tarih aralığındaki siparişlerin postingNumber'larını bulup onlar için accrual
// senkronizasyonu yapıyor (eski uç nokta gibi bağımsız bir tarih aralığı sorgusu değil).
export async function syncTransactionsForDateRange(dateFrom: string, dateTo: string): Promise<number> {
  const windowedOrders = await prisma.order.findMany({
    where: { orderDate: { gte: new Date(dateFrom), lte: new Date(dateTo) } },
    select: { postingNumber: true },
  });

  // Ozon kargo/komisyon kesintisini teslimattan SONRA (haftalar sürebilir) muhasebeleştiriyor —
  // sadece sipariş TARİHİNE göre pencerelemek, geç teslim edilen eski siparişleri kalıcı olarak
  // dışarıda bırakırdı (30 günlük pencere sürekli ileri kaydığı için orderDate bir daha asla
  // pencereye girmiyor). Bu yüzden, iptal edilmemiş ve hâlâ hiç finans verisi çekilmemiş
  // siparişler tarihten bağımsız olarak da her seferinde denemeye dahil ediliyor — veri gelince
  // (delivery gerçekleşince) bir daha bu listeye düşmezler (2026-09-09, code review bulgusu).
  const postingsWithData = await prisma.financeTransaction.findMany({
    distinct: ["postingNumber"],
    select: { postingNumber: true },
  });
  const postingsWithDataSet = new Set(postingsWithData.map((p) => p.postingNumber));
  const unsettledOrders = await prisma.order.findMany({
    where: { status: { not: "cancelled" } },
    select: { postingNumber: true },
  });
  const stillUnsettled = unsettledOrders.filter((o) => !postingsWithDataSet.has(o.postingNumber));

  return syncAccrualsForPostings([...windowedOrders, ...stillUnsettled].map((o) => o.postingNumber));
}

// Sipariş bazında basit PNL: satış tutarı - komisyon - kargo - diğer kesintiler.
export async function getPnlSummary(params: { since?: Date; to?: Date }) {
  const where = params.since || params.to
    ? { operationDate: { ...(params.since ? { gte: params.since } : {}), ...(params.to ? { lte: params.to } : {}) } }
    : {};

  const rows = await prisma.financeTransaction.findMany({ where });

  const totals = rows.reduce(
    (acc, r) => {
      acc.amount += r.amount;
      acc.commission += r.commissionAmount ?? 0;
      acc.delivery += r.deliveryCharge ?? 0;
      acc.other += r.otherCharges ?? 0;
      return acc;
    },
    { amount: 0, commission: 0, delivery: 0, other: 0 },
  );

  const byType = new Map<string, { count: number; amount: number }>();
  for (const r of rows) {
    const entry = byType.get(r.operationType) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += r.amount;
    byType.set(r.operationType, entry);
  }

  return {
    ...totals,
    // Yeni accrual verisinde her satır TEK bir kategoriye giriyor (komisyon/kargo/diğerinden
    // sadece biri dolu) — yani totals.amount zaten totals.commission+delivery+other'ın toplamı.
    // Eskiden bir "operasyon" hem kendi amount'una hem ayrı komisyon/kargo alt-alanlarına sahip
    // olabildiği için net = amount + commission + delivery + other mantıklıydı; yeni şekilde bu
    // aynı toplamı iki kere sayardı, bu yüzden net artık doğrudan amount (2026-09-09).
    net: totals.amount,
    transactionCount: rows.length,
    // Ozon, komisyon/kargo kesintilerini sipariş TESLİM edildikten sonra muhasebeleştiriyor —
    // henüz teslim edilmemiş siparişlerde sadece küçük "acquiring redistribution" düzeltme
    // işlemleri görülür, komisyon/kargo/diğer 0 kalır. UI bunu ayırt edebilsin diye tip bazında
    // döküm de dönülüyor.
    byOperationType: Array.from(byType.entries())
      .map(([operationType, v]) => ({ operationType, ...v }))
      .sort((a, b) => b.count - a.count),
  };
}
