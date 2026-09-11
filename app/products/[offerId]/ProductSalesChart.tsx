"use client";

import { useEffect, useState } from "react";
import { productApiPath } from "@/utils/decodeOfferId";

interface SalesBucket {
  period: string;
  unitsSold: number;
  revenueUsd: number;
  avgSalePriceUsd: number;
  profitUsd: number | null;
}

const RANGE_OPTIONS = [
  { label: "Son 30 gün", days: 30 },
  { label: "Son 90 gün", days: 90 },
  { label: "Son 180 gün", days: 180 },
];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("tr-TR");
}

// Ciro (mavi) ve tahmini kâr (yeşil/kırmızı) için ikili çubuk grafik — inline SVG, hover'da
// dönem+değerleri gösterir. computeOrderEstimatedProfit'in aksine burada kâr her zaman TAHMİNİ
// formülle hesaplanıyor (bkz. orders.service.ts getProductSalesHistory açıklaması).
function SalesBarChart({ buckets }: { buckets: SalesBucket[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 720;
  const height = 240;
  const padding = { top: 12, right: 12, bottom: 28, left: 12 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const maxAbs = Math.max(1, ...buckets.map((b) => Math.max(b.revenueUsd, Math.abs(b.profitUsd ?? 0))));
  const slotW = buckets.length ? plotW / buckets.length : plotW;
  const barW = Math.max(2, slotW * 0.32);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 14, marginBottom: 6, fontSize: 12 }}>
        <span className="hint" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)", display: "inline-block" }} />
          Ciro
        </span>
        <span className="hint" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--success)", display: "inline-block" }} />
          Tahmini Kâr
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <line
          x1={padding.left}
          y1={padding.top + plotH}
          x2={padding.left + plotW}
          y2={padding.top + plotH}
          stroke="var(--border)"
          strokeWidth={1}
        />
        {buckets.map((b, i) => {
          const revH = maxAbs ? (b.revenueUsd / maxAbs) * plotH : 0;
          const profit = b.profitUsd ?? 0;
          const profitH = maxAbs ? (Math.abs(profit) / maxAbs) * plotH : 0;
          const slotX = padding.left + i * slotW;
          const revX = slotX + slotW / 2 - barW - 2;
          const profitX = slotX + slotW / 2 + 2;
          const baseY = padding.top + plotH;
          const isHovered = hoverIndex === i;
          return (
            <g key={b.period}>
              <rect
                x={revX}
                y={baseY - revH}
                width={barW}
                height={Math.max(revH, 1)}
                rx={2}
                fill={isHovered ? "var(--accent-hover)" : "var(--accent)"}
              />
              <rect
                x={profitX}
                y={profit >= 0 ? baseY - profitH : baseY}
                width={barW}
                height={Math.max(profitH, 1)}
                rx={2}
                fill={profit >= 0 ? "var(--success)" : "var(--danger)"}
                opacity={isHovered ? 1 : 0.85}
              />
              <rect
                x={slotX}
                y={padding.top}
                width={slotW}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
                style={{ cursor: "pointer" }}
              />
              {(i === 0 || i === buckets.length - 1 || i % Math.ceil(buckets.length / 8) === 0) && (
                <text x={slotX + slotW / 2} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">
                  {b.period.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hoverIndex !== null && buckets[hoverIndex] && (
        <div
          style={{
            position: "absolute",
            top: 20,
            left: `${((hoverIndex + 0.5) / buckets.length) * 100}%`,
            transform: "translate(-50%, -100%)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          <div className="hint" style={{ margin: 0 }}>
            {buckets[hoverIndex].period}
          </div>
          <div>Ciro: <strong>{fmtUsd(buckets[hoverIndex].revenueUsd)}</strong></div>
          <div>
            Kâr:{" "}
            <strong>
              {buckets[hoverIndex].profitUsd != null ? fmtUsd(buckets[hoverIndex].profitUsd as number) : "alış fiyatı yok"}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProductSalesChart({ offerId }: { offerId: string }) {
  const [rangeDays, setRangeDays] = useState(30);
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [buckets, setBuckets] = useState<SalesBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const to = new Date();
    const from = new Date(Date.now() - (rangeDays - 1) * 24 * 60 * 60 * 1000);
    fetch(
      productApiPath(offerId, `/sales-history?from=${toDateStr(from)}&to=${toDateStr(to)}&granularity=${granularity}`),
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setBuckets(data.buckets ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Bilinmeyen hata"))
      .finally(() => setLoading(false));
  }, [offerId, rangeDays, granularity]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Satış Geçmişi</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              className={`btn-secondary${rangeDays === opt.days ? " active" : ""}`}
              onClick={() => setRangeDays(opt.days)}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            className={`btn-secondary${granularity === "day" ? " active" : ""}`}
            onClick={() => setGranularity("day")}
          >
            Günlük
          </button>
          <button
            type="button"
            className={`btn-secondary${granularity === "week" ? " active" : ""}`}
            onClick={() => setGranularity("week")}
          >
            Haftalık
          </button>
        </div>
      </div>

      {loading ? (
        <div className="hint">Yükleniyor...</div>
      ) : error ? (
        <div className="hint" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      ) : buckets.length === 0 ? (
        <div className="empty-state">Bu tarih aralığında satış yok.</div>
      ) : (
        <>
          <SalesBarChart buckets={buckets} />
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>{granularity === "day" ? "Tarih" : "Hafta (Pzt başlangıç)"}</th>
                  <th>Adet</th>
                  <th>Ort. Satış Fiyatı</th>
                  <th>Ciro</th>
                  <th>Tahmini Kâr</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.period}>
                    <td>{b.period}</td>
                    <td>{fmtNum(b.unitsSold)}</td>
                    <td>{fmtUsd(b.avgSalePriceUsd)}</td>
                    <td>{fmtUsd(b.revenueUsd)}</td>
                    <td style={{ color: b.profitUsd == null ? undefined : b.profitUsd >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {b.profitUsd != null ? fmtUsd(b.profitUsd) : <span className="hint">alış fiyatı yok</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
