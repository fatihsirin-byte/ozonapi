"use client";

import { useRouter, useSearchParams } from "next/navigation";

type ViewFilter = "missingCost" | "shippingLoss" | "shippingMismatch";

// /pnl'in üç "görünüm" filtresi (birbirini dışlar) + bir "değiştirici" (useEstimateForDisputed,
// görünümden bağımsız her zaman uygulanabilir) — hepsi query string'te tutuluyor ki CSV export
// da aynı state'i okuyabilsin (2026-09-09, kullanıcı talebi: "csv her zaman filtrelere göre
// çalışsın"). Tek yerden yönetiliyor ki bir filtreyi açarken diğerlerini yanlışlıkla silmeyelim.
export function PnlFilterControls({
  missingCostCount,
  missingCostGroupCount,
  shippingLossCount,
  shippingMismatchCount,
}: {
  missingCostCount: number;
  missingCostGroupCount: number;
  shippingLossCount: number;
  shippingMismatchCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeView = (["missingCost", "shippingLoss", "shippingMismatch"] as ViewFilter[]).find(
    (v) => searchParams.get(v) === "1",
  );
  const useEstimateForDisputed = searchParams.get("useEstimateForDisputed") === "1";

  function toggleView(view: ViewFilter) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("missingCost");
    next.delete("shippingLoss");
    next.delete("shippingMismatch");
    if (activeView !== view) next.set(view, "1");
    router.push(`/pnl${next.toString() ? `?${next.toString()}` : ""}`);
  }

  function toggleEstimateOverride(checked: boolean) {
    const next = new URLSearchParams(searchParams.toString());
    if (checked) next.set("useEstimateForDisputed", "1");
    else next.delete("useEstimateForDisputed");
    router.push(`/pnl${next.toString() ? `?${next.toString()}` : ""}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
      {missingCostCount > 0 && (
        <div className="hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {missingCostCount} kalemde ({missingCostGroupCount} farklı üründe) alış fiyatı girilmemiş —
          bunlar toplamlara dahil edilmedi.
          <button className="btn-secondary" style={{ padding: "2px 10px", fontSize: 12 }} onClick={() => toggleView("missingCost")}>
            {activeView === "missingCost" ? "Tüm listeye dön" : "Sadece eksik olanları göster"}
          </button>
        </div>
      )}
      {shippingLossCount > 0 && (
        <div className="hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {shippingLossCount} kalemde gerçek kargo, tahminden daha yüksek (kırmızı "Fark").
          <button className="btn-secondary" style={{ padding: "2px 10px", fontSize: 12 }} onClick={() => toggleView("shippingLoss")}>
            {activeView === "shippingLoss" ? "Tüm listeye dön" : "Sadece zarar edilen kargoları göster"}
          </button>
        </div>
      )}
      {shippingMismatchCount > 0 && (
        <div className="hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {shippingMismatchCount} kalemde gerçek kargo, ağırlık tahmininden farklı (yön fark etmeksizin).
          <button className="btn-secondary" style={{ padding: "2px 10px", fontSize: 12 }} onClick={() => toggleView("shippingMismatch")}>
            {activeView === "shippingMismatch" ? "Tüm listeye dön" : "Hatalı hesaplanan kargoları göster"}
          </button>
        </div>
      )}
      {shippingMismatchCount > 0 && (
        <label className="hint" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={useEstimateForDisputed}
            onChange={(e) => toggleEstimateOverride(e.target.checked)}
          />
          Mütabık olunmayan (gerçek ≠ tahmini) kargoları tahminle değiştir — Özet ve tablo tahmine göre yeniden hesaplansın
        </label>
      )}
    </div>
  );
}
