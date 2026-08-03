"use client";

import { useState } from "react";
import { computePriceBreakdown } from "@/pricing/formula";

interface Props {
  costPrice: string;
  weightGrams: number | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  packagingExtraGrams?: number | null;
  currentPrice: string;
  onClose(): void;
  onApply(priceUsd: string): void;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "Ozon Fiyat Hesaplayıcı" tarayıcı eklentisindeki (ozon-fiyat-hesaplayici/content.js)
// recalcBreakdown() ile aynı mantık — aynı formula.ts'i kullanıyor, tek fark burada
// gerçekten Ozon'a kaydedebiliyor olması (eklenti sadece görüntüleme/doğrulama içindi).
export function PriceCalculatorModal({
  costPrice,
  weightGrams,
  widthCm,
  heightCm,
  depthCm,
  packagingExtraGrams,
  currentPrice,
  onClose,
  onApply,
}: Props) {
  const dims = { widthCm, heightCm, depthCm };
  const recommended = computePriceBreakdown(costPrice, weightGrams, dims, undefined, packagingExtraGrams);
  const [priceInput, setPriceInput] = useState(currentPrice || recommended?.recommendedPriceUsd.toFixed(2) || "");

  const breakdown = computePriceBreakdown(costPrice, weightGrams, dims, Number(priceInput) || undefined, packagingExtraGrams);

  const deltaPct =
    breakdown && recommended && recommended.recommendedPriceUsd
      ? ((breakdown.actualPriceUsd - recommended.recommendedPriceUsd) / recommended.recommendedPriceUsd) * 100
      : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <strong style={{ fontSize: 18 }}>Fiyat Hesaplayıcı</strong>
          <button type="button" className="btn-secondary" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="field">
          <label>Alış Fiyatı (USD)</label>
          {costPrice || <span className="hint">—</span>}
        </div>

        {recommended && (
          <div className="field">
            <label>Önerilen Satış Fiyatı (USD) — %40 marj hedefi</label>
            <div style={{ color: "var(--success)", fontWeight: 600 }}>${fmt(recommended.recommendedPriceUsd)}</div>
          </div>
        )}

        <div className="field">
          <label>Satış Fiyatı (USD) — değiştirilebilir</label>
          <input type="number" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} />
        </div>

        {deltaPct !== null && Math.abs(deltaPct) > 1 && (
          <div className="hint" style={{ color: deltaPct < 0 ? "var(--danger)" : "var(--muted)" }}>
            {deltaPct < 0
              ? `⚠️ Girilen fiyat, önerilenden %${fmt(Math.abs(deltaPct))} düşük — kâr marjı hedefin altında.`
              : `Girilen fiyat, önerilenden %${fmt(deltaPct)} yüksek.`}
          </div>
        )}

        {breakdown && (
          <div className="breakdown-grid">
            <div>
              <span>Alış (USD)</span>
              <strong>${fmt(breakdown.costUsd)}</strong>
            </div>
            <div>
              <span>Kargo (USD)</span>
              <strong>${fmt(breakdown.shippingUsd)}</strong>
            </div>
            <div>
              <span>Kâr (USD)</span>
              <strong style={{ color: breakdown.profitUsd >= 0 ? "var(--success)" : "var(--danger)" }}>
                ${fmt(breakdown.profitUsd)}
              </strong>
            </div>
            <div>
              <span>Kâr Marjı (alıştan, %)</span>
              <strong style={{ color: breakdown.marginPct >= 0 ? "var(--success)" : "var(--danger)" }}>
                %{fmt(breakdown.marginPct)}
              </strong>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            İptal
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1 }}
            disabled={!priceInput}
            onClick={() => onApply(priceInput)}
          >
            Bu Fiyatı Kullan
          </button>
        </div>
      </div>
    </div>
  );
}
