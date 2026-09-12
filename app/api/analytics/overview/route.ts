import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsByDay, ANALYTICS_METRICS } from "@/ozon/analytics";
import { OzonApiError } from "@/ozon/client";
import { getUsdToRubRate } from "@/pricing/fx-rate";
import { getDailySalesStats } from "@/modules/orders/orders.service";
import { getDailyProfitStats } from "@/modules/finance/pnl-report.service";
import { istanbulDayBoundsUtc } from "@/utils/dateTr";

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
    // Ozon'un "day" dimension'ı Moskova saatine göre gruplanıyor gibi görünüyor — Türkiye de yıl
    // boyu sabit UTC+3 (DST yok) olduğu için sayısal olarak hep eşit; yerel sipariş verimizi de
    // (sipariş adedi + satılan ürün adedi, Günlük Ciro grafiğinin tooltip'i için) AYNI takvim
    // günlerine göre çekip aşağıda tarihe göre eşliyoruz (2026-09-12, kullanıcı talebi).
    const { start: dailyStatsSince } = istanbulDayBoundsUtc(dateFrom);
    const { end: dailyStatsTo } = istanbulDayBoundsUtc(dateTo);
    const [{ result }, usdToRubRate, dailySales, profitByDate] = await Promise.all([
      getAnalyticsByDay(dateFrom, dateTo),
      getUsdToRubRate(),
      getDailySalesStats({ since: dailyStatsSince, to: dailyStatsTo }),
      getDailyProfitStats({ since: dailyStatsSince, to: dailyStatsTo }),
    ]);
    const salesByDate = new Map(dailySales.map((d) => [d.date, d]));
    const toMetricObject = (metrics: number[]) => {
      const obj: Record<string, number> = {};
      ANALYTICS_METRICS.forEach((key, i) => {
        obj[key] = metrics[i] ?? 0;
      });
      // Ozon'un analitik uç noktası "revenue"yu HER ZAMAN RUB döner (hesabın sözleşme para
      // birimi USD olsa da) — sitedeki diğer her yer ($ olarak) dolar gösterdiği için burada da
      // çeviriyoruz; kur çekilemezse (ağ hatası) ham RUB değeri kalır, sayfa çökmesin diye
      // (2026-09-11, kullanıcı talebi: "ciroyu ruble gösteriyor dolar yap").
      if (usdToRubRate) obj.revenue = obj.revenue / usdToRubRate;
      return obj;
    };

    const days = result.data.map((row) => {
      const date = row.dimensions[0]?.id ?? "";
      const sales = salesByDate.get(date);
      // orderCount/unitsSold Ozon'un analitik metriklerinden DEĞİL, yukarıdaki yerel sipariş
      // sorgusundan geliyor — "Günlük Ciro" grafiğinde ciro'nun yanında sipariş adedi ve satılan
      // ürün adedini de göstermek için (bkz. getDailySalesStats açıklaması).
      // profitUsd Kâr/Zarar sayfasıyla AYNI kurallarla (getPnlRows/computeRowMetrics — gerçek
      // kargo/komisyon varsa o, yoksa tahmini formül) hesaplanıyor ve SADECE "delivered" siparişleri
      // kapsıyor (2026-09-13, kullanıcı talebi) — henüz teslim edilmemiş güncel günlerde 0 görünmesi
      // normaldir, bkz. getDailyProfitStats.
      return {
        date,
        ...toMetricObject(row.metrics),
        orderCount: sales?.orderCount ?? 0,
        unitsSold: sales?.unitsSold ?? 0,
        profitUsd: profitByDate[date] ?? 0,
      };
    });
    days.sort((a, b) => a.date.localeCompare(b.date));

    const totalProfitUsd = Object.values(profitByDate).reduce((sum, v) => sum + v, 0);

    return NextResponse.json({
      days,
      totals: { ...toMetricObject(result.totals), profitUsd: totalProfitUsd },
      revenueCurrency: usdToRubRate ? "USD" : "RUB",
    });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Analitik verisi alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
