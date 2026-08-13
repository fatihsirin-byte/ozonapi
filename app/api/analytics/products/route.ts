import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsBySku } from "@/ozon/analytics";
import { OzonApiError } from "@/ozon/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");
  const limit = Number(searchParams.get("limit")) || 20;
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "from ve to (YYYY-MM-DD) gerekli" }, { status: 400 });
  }

  try {
    const { result } = await getAnalyticsBySku(dateFrom, dateTo, 1000);
    const items = result.data
      .map((row) => ({
        sku: row.dimensions[0]?.id ?? "",
        name: row.dimensions[0]?.name ?? "",
        revenue: row.metrics[0] ?? 0,
        orderedUnits: row.metrics[1] ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Analitik verisi alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
