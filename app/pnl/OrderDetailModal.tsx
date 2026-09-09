"use client";

import { useMemo } from "react";
import Link from "next/link";
import { computeRowMetrics, type PnlRow } from "@/modules/finance/pnl-report.service";
import { CopyableProductName } from "./CopyableProductName";

function fmtMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null) {
  if (n == null) return "-";
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}%`;
}

// Bağımlılık eklemeden basit bir aylık trend çubuk grafiği — ürünün TÜM siparişleri (bu
// modal'daki tek siparişle sınırlı değil) üzerinden ay bazında net kâr toplamı.
function MonthlyTrendChart({ allRows, offerId }: { allRows: PnlRow[]; offerId: string }) {
  const monthly = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of allRows) {
      if (r.offerId !== offerId || !r.orderDate) continue;
      const m = computeRowMetrics(r);
      if (m.profit == null) continue;
      const month = r.orderDate.slice(0, 7);
      map.set(month, (map.get(month) ?? 0) + m.profit);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [allRows, offerId]);

  if (monthly.length === 0) {
    return <div className="hint">Bu ürün için henüz aylık kâr verisi yok.</div>;
  }

  const width = 320;
  const height = 90;
  const midY = height / 2;
  const barGap = 4;
  const barWidth = width / monthly.length;
  const maxAbs = Math.max(...monthly.map(([, v]) => Math.abs(v)), 0.01);

  return (
    <svg width={width} height={height + 16} role="img" aria-label="Aylık kâr trendi">
      <line x1={0} y1={midY} x2={width} y2={midY} stroke="var(--border)" strokeWidth={1} />
      {monthly.map(([month, profit], i) => {
        const barHeight = (Math.abs(profit) / maxAbs) * (midY - 4);
        const isPositive = profit >= 0;
        const x = i * barWidth + barGap / 2;
        const y = isPositive ? midY - barHeight : midY;
        return (
          <g key={month}>
            <rect
              x={x}
              y={y}
              width={Math.max(barWidth - barGap, 2)}
              height={Math.max(barHeight, 1)}
              fill={isPositive ? "var(--success)" : "var(--danger)"}
              rx={2}
            >
              <title>{`${month}: ${fmtMoney(profit)}`}</title>
            </rect>
            <text x={x + (barWidth - barGap) / 2} y={height + 12} fontSize={9} textAnchor="middle" fill="var(--muted)">
              {month.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function OrderDetailModal({
  postingNumber,
  items,
  allRows,
  onClose,
}: {
  postingNumber: string;
  items: PnlRow[];
  allRows: PnlRow[];
  onClose: () => void;
}) {
  const metrics = items.map((row) => ({ row, m: computeRowMetrics(row) }));
  const totals = metrics.reduce(
    (acc, { m }) => ({
      totalSale: acc.totalSale + m.totalSale,
      totalCost: m.totalCost == null ? acc.totalCost : acc.totalCost + m.totalCost,
      commission: acc.commission + m.commission,
      logistics: acc.logistics + m.logistics,
      bankFee: acc.bankFee + m.bankFee,
      shipping: acc.shipping + (m.shipping ?? 0),
      profit: m.profit == null ? acc.profit : acc.profit + m.profit,
      hasAllCosts: acc.hasAllCosts && m.totalCost != null,
    }),
    { totalSale: 0, totalCost: 0, commission: 0, logistics: 0, bankFee: 0, shipping: 0, profit: 0, hasAllCosts: true },
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 640, width: "90vw", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
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

        {metrics.map(({ row, m }) => (
          <div key={row.offerId} style={{ display: "flex", gap: 12, padding: "12px 0", borderTop: "1px solid var(--border)" }}>
            {row.productImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.productImage}
                alt=""
                width={64}
                height={64}
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
                Adet: {row.quantity} · Net ağırlık: {row.netWeightGrams != null ? `${row.netWeightGrams}g` : "-"} · Kargo ağırlığı:{" "}
                {row.cargoWeightGrams != null ? `${Math.round(row.cargoWeightGrams)}g` : "-"}
                {row.widthCm != null && row.heightCm != null && row.depthCm != null && (
                  <> · Boyut: {row.widthCm}×{row.heightCm}×{row.depthCm} cm</>
                )}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
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
                <div>
                  <div className="hint">Marj</div>
                  <div>{fmtPct(m.marginPct)}</div>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="hint" style={{ marginBottom: 4 }}>Aylık kâr trendi (bu ürünün tüm siparişleri)</div>
                <MonthlyTrendChart allRows={allRows} offerId={row.offerId} />
              </div>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
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
              <strong>{fmtMoney(totals.commission + totals.logistics + totals.bankFee)}</strong>
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
