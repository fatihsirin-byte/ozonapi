"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface DayRow {
  date: string;
  revenue: number;
  ordered_units: number;
  hits_view: number;
  hits_tocart: number;
  conv_tocart: number;
  returns: number;
  cancellations: number;
}

interface Totals {
  revenue: number;
  ordered_units: number;
  hits_view: number;
  hits_tocart: number;
  conv_tocart: number;
  returns: number;
  cancellations: number;
}

interface TopProduct {
  sku: string;
  name: string;
  revenue: number;
  orderedUnits: number;
  offerId: string | null;
}

const RANGE_OPTIONS = [
  { label: "Son 7 gün", days: 7 },
  { label: "Son 14 gün", days: 14 },
  { label: "Son 30 gün", days: 30 },
];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtRub(n: number): string {
  return `₽${n.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("tr-TR");
}

// Basit, tek seri (günlük ciro) çubuk grafik — inline SVG, hover'da tarih+değer gösterir.
// Tek seri olduğu için legend gerekmiyor (başlık zaten seriyi adlandırıyor).
function RevenueBarChart({ days }: { days: DayRow[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 720;
  const height = 220;
  const padding = { top: 12, right: 12, bottom: 28, left: 12 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const maxRevenue = Math.max(1, ...days.map((d) => d.revenue));
  const slotW = days.length ? plotW / days.length : plotW;
  const barW = Math.max(2, slotW * 0.6);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* Baseline */}
        <line
          x1={padding.left}
          y1={padding.top + plotH}
          x2={padding.left + plotW}
          y2={padding.top + plotH}
          stroke="var(--border)"
          strokeWidth={1}
        />
        {days.map((d, i) => {
          const barH = maxRevenue ? (d.revenue / maxRevenue) * plotH : 0;
          const x = padding.left + i * slotW + (slotW - barW) / 2;
          const y = padding.top + plotH - barH;
          const isHovered = hoverIndex === i;
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, 1)}
                rx={3}
                fill={isHovered ? "var(--accent-hover)" : "var(--accent)"}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
                style={{ cursor: "pointer" }}
              />
              {/* Görünmez, tam yükseklikte hit-target — küçük çubuklarda da hover kolay tetiklensin */}
              <rect
                x={padding.left + i * slotW}
                y={padding.top}
                width={slotW}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
              />
              {(i === 0 || i === days.length - 1 || i % Math.ceil(days.length / 6) === 0) && (
                <text
                  x={x + barW / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--muted)"
                >
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hoverIndex !== null && days[hoverIndex] && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${((hoverIndex + 0.5) / days.length) * 100}%`,
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
            {days[hoverIndex].date}
          </div>
          <strong>{fmtRub(days[hoverIndex].revenue)}</strong>
        </div>
      )}
    </div>
  );
}

export function AnalyticsView() {
  const [rangeDays, setRangeDays] = useState(14);
  const [days, setDays] = useState<DayRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [products, setProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { from, to } = useMemo(() => {
    const toDate = new Date();
    const fromDate = new Date(Date.now() - (rangeDays - 1) * 24 * 60 * 60 * 1000);
    return { from: toDateStr(fromDate), to: toDateStr(toDate) };
  }, [rangeDays]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/analytics/overview?from=${from}&to=${to}`).then((r) => r.json()),
      fetch(`/api/analytics/products?from=${from}&to=${to}&limit=15`).then((r) => r.json()),
    ])
      .then(([overview, topProducts]) => {
        if (overview.error) {
          setError(overview.error);
          return;
        }
        setDays(overview.days ?? []);
        setTotals(overview.totals ?? null);
        setProducts(topProducts.items ?? []);
      })
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <div className="card">
      <div className="filter-bar">
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
      </div>

      {loading ? (
        <div className="hint">Yükleniyor...</div>
      ) : error ? (
        <div className="hint" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      ) : (
        <>
          {totals && (
            <div className="summary-grid" style={{ marginBottom: 24 }}>
              <div>
                <div className="hint">Toplam Ciro (₽)</div>
                <div className="value">{fmtRub(totals.revenue)}</div>
              </div>
              <div>
                <div className="hint">Sipariş Adedi</div>
                <div className="value">{fmtNum(totals.ordered_units)}</div>
              </div>
              <div>
                <div className="hint">Görüntülenme</div>
                <div className="value">{fmtNum(totals.hits_view)}</div>
              </div>
              <div>
                <div className="hint">Sepete Ekleme</div>
                <div className="value">{fmtNum(totals.hits_tocart)}</div>
              </div>
              <div>
                <div className="hint">Sepete Ekleme Oranı</div>
                <div className="value">%{totals.conv_tocart.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}</div>
              </div>
              <div>
                <div className="hint">İade</div>
                <div className="value" style={{ color: totals.returns > 0 ? "var(--danger)" : undefined }}>
                  {fmtNum(totals.returns)}
                </div>
              </div>
              <div>
                <div className="hint">İptal</div>
                <div className="value" style={{ color: totals.cancellations > 0 ? "var(--danger)" : undefined }}>
                  {fmtNum(totals.cancellations)}
                </div>
              </div>
            </div>
          )}

          <div style={{ marginBottom: 8 }}>
            <strong>Günlük Ciro</strong>
          </div>
          {days.length > 0 ? (
            <RevenueBarChart days={days} />
          ) : (
            <div className="hint">Bu tarih aralığında veri yok.</div>
          )}

          <div style={{ marginTop: 32, marginBottom: 8 }}>
            <strong>En Çok Satan Ürünler</strong>
          </div>
          {products.length === 0 ? (
            <div className="empty-state">Bu tarih aralığında satış yok.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Ciro (₽)</th>
                  <th>Adet</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.sku}>
                    <td>
                      {p.offerId ? (
                        <Link href={`/products/${encodeURIComponent(p.offerId)}`}>{p.name || p.sku}</Link>
                      ) : (
                        p.name || p.sku
                      )}
                    </td>
                    <td>{fmtRub(p.revenue)}</td>
                    <td>{fmtNum(p.orderedUnits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
