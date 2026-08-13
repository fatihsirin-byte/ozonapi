import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsByDay, ANALYTICS_METRICS } from "@/ozon/analytics";
import { OzonApiError } from "@/ozon/client";

// Metrik dizisindeki sıra ANALYTICS_METRICS'teki sırayla birebir eşleşiyor (Ozon dizi olarak
// dönüyor, isim eşlemesi biz yapıyoruz).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "from ve to (YYYY-MM-DD) gerekli" }, { status: 400 });
  }

  try {
    const { result } = await getAnalyticsByDay(dateFrom, dateTo);
    const toMetricObject = (metrics: number[]) => {
      const obj: Record<string, number> = {};
      ANALYTICS_METRICS.forEach((key, i) => {
        obj[key] = metrics[i] ?? 0;
      });
      return obj;
    };

    const days = result.data.map((row) => ({ date: row.dimensions[0]?.id ?? "", ...toMetricObject(row.metrics) }));
    days.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ days, totals: toMetricObject(result.totals) });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Analitik verisi alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
