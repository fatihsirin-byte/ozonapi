import { prisma } from "../../db/prisma";
import { listFbsPostings, type OzonFbsPosting } from "../../ozon/orders";

// Ozon'daki siparişleri çekip local DB'ye upsert eder, durum takibi için kullanılır.
export async function syncFbsOrders(params: { since: string; to: string; status?: string }) {
  let offset = 0;
  const limit = 100;
  let hasNext = true;
  const synced: OzonFbsPosting[] = [];

  while (hasNext) {
    const { result } = await listFbsPostings({ ...params, offset, limit });

    for (const posting of result.postings) {
      await prisma.order.upsert({
        where: { postingNumber: posting.posting_number },
        create: {
          postingNumber: posting.posting_number,
          status: posting.status,
          scheme: "fbs",
          orderDate: new Date(posting.order_date),
          rawPayload: posting as unknown as object,
        },
        update: {
          status: posting.status,
          rawPayload: posting as unknown as object,
        },
      });
      synced.push(posting);
    }

    hasNext = result.has_next;
    offset += limit;
  }

  return synced;
}
