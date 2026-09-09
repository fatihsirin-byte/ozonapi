import { NextRequest, NextResponse } from "next/server";
import {
  getPnlRows,
  buildPnlCsv,
  groupMissingCostPrice,
  filterShippingLoss,
  filterShippingMismatch,
  overrideDisputedShippingWithEstimate,
} from "@/modules/finance/pnl-report.service";

// UI'daki "CSV İndir" butonu — src/scripts/export-pnl-csv.ts ile birebir aynı csv builder'ı
// kullanıyor (bkz. pnl-report.service.ts), tek fark bu route canlı Ozon senkronizasyonu
// YAPMAZ, sadece o an DB'de ne varsa onu yazar (hızlı kalsın diye — tam geçmiş senkronizasyonu
// gerekiyorsa /pnl sayfasındaki "Senkronize Et" butonuyla veya scriptle yapılır).
// missingCost/shippingLoss/shippingMismatch/useEstimateForDisputed parametreleri /pnl
// sayfasındaki filtre kontrolleriyle (bkz. PnlFilterControls.tsx) birebir aynı — CSV her zaman
// ekranda seçili filtreye göre insin diye (2026-09-09, kullanıcı talebi).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since") ? new Date(searchParams.get("since")!) : undefined;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;

  let rows = await getPnlRows({ since, to });
  if (searchParams.get("useEstimateForDisputed") === "1") {
    rows = overrideDisputedShippingWithEstimate(rows);
  }
  if (searchParams.get("shippingLoss") === "1") {
    rows = filterShippingLoss(rows);
  } else if (searchParams.get("shippingMismatch") === "1") {
    rows = filterShippingMismatch(rows);
  }
  if (searchParams.get("missingCost") === "1") {
    const missingOfferIds = new Set(groupMissingCostPrice(rows).map((g) => g.offerId));
    rows = rows.filter((r) => missingOfferIds.has(r.offerId));
  }
  const csv = buildPnlCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pnl-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
