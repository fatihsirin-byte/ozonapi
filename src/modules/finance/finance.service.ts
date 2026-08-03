import { prisma } from "../../db/prisma";
import { listTransactions, type OzonFinanceTransactionItem } from "../../ozon/finance";

async function upsertTransaction(op: OzonFinanceTransactionItem) {
  await prisma.financeTransaction.upsert({
    where: { operationId: BigInt(op.operation_id) },
    create: {
      operationId: BigInt(op.operation_id),
      postingNumber: op.posting.posting_number,
      operationType: op.operation_type,
      operationDate: new Date(op.operation_date),
      amount: op.amount,
      commissionAmount: op.sale_commission,
      deliveryCharge: op.delivery_charge,
      otherCharges: op.return_delivery_charge,
      rawPayload: op as unknown as object,
    },
    update: {
      amount: op.amount,
      commissionAmount: op.sale_commission,
      deliveryCharge: op.delivery_charge,
      otherCharges: op.return_delivery_charge,
      rawPayload: op as unknown as object,
    },
  });
}

// Tek bir posting_number için komisyon, kargo ve diğer kesintileri çekip DB'ye kaydeder.
export async function syncTransactionsForPosting(postingNumber: string) {
  const { result } = await listTransactions({ postingNumber });
  for (const op of result.operations) {
    await upsertTransaction(op);
  }
  return result.operations;
}

// PNL için: verilen tarih aralığındaki TÜM finans işlemlerini (sipariş bağı olsun olmasın) sayfalayarak çeker.
export async function syncTransactionsForDateRange(dateFrom: string, dateTo: string) {
  let page = 1;
  const pageSize = 1000;
  let pageCount = 1;
  let total = 0;

  do {
    const { result } = await listTransactions({ dateFrom, dateTo, page, pageSize });
    for (const op of result.operations) {
      await upsertTransaction(op);
      total += 1;
    }
    pageCount = result.page_count;
    page += 1;
  } while (page <= pageCount);

  return total;
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

  return {
    ...totals,
    net: totals.amount + totals.commission + totals.delivery + totals.other,
    transactionCount: rows.length,
  };
}
