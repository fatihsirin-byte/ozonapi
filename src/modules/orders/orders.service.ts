import { prisma } from "../../db/prisma";
import { listFbsPostings, type OzonFbsPosting } from "../../ozon/orders";

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
      include: { items: true },
      orderBy: { orderDate: "desc" },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total };
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
