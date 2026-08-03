import { NextRequest, NextResponse } from "next/server";
import { syncFbsOrders } from "@/modules/orders/orders.service";
import { syncTransactionsForDateRange } from "@/modules/finance/finance.service";
import { OzonApiError } from "@/ozon/client";

// Elle "Senkronize Et" butonu için — varsayılan son 30 gün. Aynı işlem cron ile de periyodik çalışıyor (bkz. src/scripts/sync-orders-cron.ts).
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { since?: string; to?: string };
  const to = body.to ?? new Date().toISOString();
  const since = body.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const orders = await syncFbsOrders({ since, to });
    const transactionCount = await syncTransactionsForDateRange(since, to);
    return NextResponse.json({ orderCount: orders.length, transactionCount });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    throw error;
  }
}
