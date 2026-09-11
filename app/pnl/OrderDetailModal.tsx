"use client";

import Link from "next/link";
import { computeRowMetrics, type PnlRow, type PnlRowMetrics } from "@/modules/finance/pnl-report.service";
import { CopyableProductName } from "./CopyableProductName";

function fmtMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null) {
  if (n == null) return "-";
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}%`;
}

const DONUT_COLORS = {
  cost: "var(--danger)",
  shipping: "#f0ad4e",
  fees: "#8884d8",
  profit: "var(--success)",
};

// Bağımlılık eklemeden CSS conic-gradient ile halka (donut) kırılım grafiği — kullanıcı talebi
// "halka grafik, %sel olarak renklerle kırılımı çemberde göster" (2026-09-09). Aylık trend çubuğu
// değil, TEK bir kalemin satış tutarının alış/kargo/komisyon+lojistik+banka/net kâr olarak
// yüzdesel dağılımı.
function BreakdownDonut({ m }: { m: PnlRowMetrics }) {
  const cost = m.totalCost ?? 0;
  const shipping = m.shipping ?? 0;
  const fees = m.feesUsd;
  const positiveProfit = m.profit != null && m.profit > 0 ? m.profit : 0;
  const base = cost + shipping + fees + positiveProfit;

  if (base <= 0) return <div className="hint">Kırılım için yeterli veri yok.</div>;

  const segments = [
    { label: "Alış", value: cost, color: DONUT_COLORS.cost },
    { label: "Kargo", value: shipping, color: DONUT_COLORS.shipping },
    { label: "Komisyon+Lojistik+Banka", value: fees, color: DONUT_COLORS.fees },
    { label: "Net Kâr", value: positiveProfit, color: DONUT_COLORS.profit },
  ].filter((s) => s.value > 0);

  let cursor = 0;
  const stops = segments
    .map((s) => {
      const pct = (s.value / base) * 100;
      const from = cursor;
      cursor += pct;
      return `${s.color} ${from}% ${cursor}%`;
    })
    .join(", ");

  const size = 72;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <div style={{ width: size, height: size, borderRadius: "50%", background: `conic-gradient(${stops})` }} />
        <div
          style={{
            position: "absolute",
            inset: size * 0.26,
            borderRadius: "50%",
            background: "var(--surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 600,
            textAlign: "center",
            color: m.profit == null ? "var(--muted)" : m.profit >= 0 ? "var(--success)" : "var(--danger)",
          }}
        >
          {fmtPct(m.marginPct)}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, minWidth: 0 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0, display: "inline-block" }} />
            <span className="hint">
              {s.label}: {fmtMoney(s.value)} ({((s.value / base) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
        {m.profit != null && m.profit < 0 && (
          <div className="hint" style={{ color: "var(--danger)" }}>
            Zarar: {fmtMoney(m.profit)}
          </div>
        )}
      </div>
    </div>
  );
}

export function OrderDetailModal({
  postingNumber,
  items,
  onClose,
}: {
  postingNumber: string;
  items: PnlRow[];
  onClose: () => void;
}) {
  const metrics = items.map((row) => ({ row, m: computeRowMetrics(row) }));
  const totals = metrics.reduce(
    (acc, { m }) => ({
      totalSale: acc.totalSale + m.totalSale,
      totalCost: m.totalCost == null ? acc.totalCost : acc.totalCost + m.totalCost,
      feesUsd: acc.feesUsd + m.feesUsd,
      shipping: acc.shipping + (m.shipping ?? 0),
      profit: m.profit == null ? acc.profit : acc.profit + m.profit,
      hasAllCosts: acc.hasAllCosts && m.totalCost != null,
    }),
    { totalSale: 0, totalCost: 0, feesUsd: 0, shipping: 0, profit: 0, hasAllCosts: true },
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 980, width: "95vw", maxHeight: "92vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <strong style={{ fontSize: 18 }}>{postingNumber}</strong>
            <div className="hint">
              {items[0]?.orderDate ?? "-"} · <span className="badge pending">{items[0]?.status}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link href={`/orders/${postingNumber}`} className="hint">
              Tam sipariş sayfasını aç ↗
            </Link>
            <button type="button" className="btn-secondary" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12 }}>
          {metrics.map(({ row, m }) => (
            <div key={row.offerId} style={{ display: "flex", gap: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
              {row.productImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.productImage}
                  alt=""
                  width={56}
                  height={56}
                  style={{ objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  <CopyableProductName name={row.productName} nameRu={row.productNameRu} />
                </div>
                <div className="hint">
                  {row.offerId}
                  {row.ozonSku && (
                    <>
                      {" · "}
                      <a href={`https://www.ozon.ru/context/detail/id/${row.ozonSku}/`} target="_blank" rel="noopener noreferrer">
                        Ozon'da gör ↗
                      </a>
                    </>
                  )}
                </div>
                <div className="hint" style={{ marginTop: 4 }}>
                  Adet: {row.quantity} · Net: {row.netWeightGrams != null ? `${row.netWeightGrams}g` : "-"} · Kargo:{" "}
                  {row.cargoWeightGrams != null ? `${Math.round(row.cargoWeightGrams)}g` : "-"}
                  {row.widthCm != null && row.heightCm != null && row.depthCm != null && (
                    <> · {row.widthCm}×{row.heightCm}×{row.depthCm} cm</>
                  )}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 6, marginBottom: 8 }}>
                  <div>
                    <div className="hint">Satış</div>
                    <div>{fmtMoney(m.totalSale)}</div>
                  </div>
                  <div>
                    <div className="hint">Alış</div>
                    <div>{m.totalCost != null ? fmtMoney(m.totalCost) : <Link href="/pnl?missingCost=1">eksik</Link>}</div>
                  </div>
                  <div>
                    <div className="hint">Net Kâr</div>
                    <div style={{ color: m.profit == null ? undefined : m.profit >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {m.profit != null ? fmtMoney(m.profit) : "-"}
                    </div>
                  </div>
                </div>
                <BreakdownDonut m={m} />
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <strong>Sipariş Toplamı</strong>
          <div className="breakdown-grid" style={{ marginTop: 8 }}>
            <div>
              <span>Satış</span>
              <strong>{fmtMoney(totals.totalSale)}</strong>
            </div>
            <div>
              <span>Alış</span>
              <strong>{totals.hasAllCosts ? fmtMoney(totals.totalCost) : "eksik"}</strong>
            </div>
            <div>
              <span>Kargo</span>
              <strong>{fmtMoney(totals.shipping)}</strong>
            </div>
            <div>
              <span>Komisyon + Lojistik + Banka</span>
              <strong>{fmtMoney(totals.feesUsd)}</strong>
            </div>
            <div>
              <span>Net Kâr</span>
              <strong style={{ color: totals.hasAllCosts ? (totals.profit >= 0 ? "var(--success)" : "var(--danger)") : undefined }}>
                {totals.hasAllCosts ? fmtMoney(totals.profit) : "-"}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
