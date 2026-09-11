import { NextRequest, NextResponse } from "next/server";
import { getProductSalesHistory } from "@/modules/orders/orders.service";

// route.ts'e gelen params Next tarafından zaten çözülmüş oluyor — tekrar decode ETME (bkz.
// app/api/products/[offerId]/route.ts'teki uyarı yorumu).
export async function GET(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");
  const granularity = searchParams.get("granularity") === "week" ? "week" : "day";
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "from ve to (YYYY-MM-DD) gerekli" }, { status: 400 });
  }

  const since = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T23:59:59.999Z`);
  if (Number.isNaN(since.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "from/to geçerli bir tarih (YYYY-MM-DD) olmalı" }, { status: 400 });
  }

  try {
    const buckets = await getProductSalesHistory(offerId, { since, to, granularity });
    return NextResponse.json({ buckets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Satış geçmişi alınamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
