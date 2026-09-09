import { NextRequest, NextResponse } from "next/server";
import { getPnlRows, buildPnlCsv } from "@/modules/finance/pnl-report.service";

// UI'daki "CSV İndir" butonu — src/scripts/export-pnl-csv.ts ile birebir aynı csv builder'ı
// kullanıyor (bkz. pnl-report.service.ts), tek fark bu route canlı Ozon senkronizasyonu
// YAPMAZ, sadece o an DB'de ne varsa onu yazar (hızlı kalsın diye — tam geçmiş senkronizasyonu
// gerekiyorsa /pnl sayfasındaki "Senkronize Et" butonuyla veya scriptle yapılır).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since") ? new Date(searchParams.get("since")!) : undefined;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;

  const rows = await getPnlRows({ since, to });
  const csv = buildPnlCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pnl-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
