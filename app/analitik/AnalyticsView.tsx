"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { istanbulDateStr } from "@/utils/dateTr";

interface DayRow {
  date: string;
  revenue: number;
  ordered_units: number;
  hits_view: number;
  hits_tocart: number;
  conv_tocart: number;
  returns: number;
  cancellations: number;
  // Ozon'un analitik metriklerinden değil, sunucudaki yerel sipariş verisinden geliyor (bkz.
  // app/api/analytics/overview/route.ts + orders.service.ts getDailySalesStats) — "Günlük Ciro"
  // grafiğinin tooltip'inde ciro'nun yanında gösteriliyor (2026-09-12, kullanıcı talebi).
  orderCount: number;
  unitsSold: number;
  // Kâr/Zarar sayfasıyla AYNI kurallarla (komisyon, kargo — gerçek varsa o, yoksa tahmini formül,
  // maliyet düşülmüş) hesaplanıyor, HER ZAMAN USD — bkz. app/api/analytics/overview/route.ts +
  // pnl-report.service.ts getDailyProfitStats. Sadece "delivered" siparişleri kapsar (2026-09-13,
  // kullanıcı talebi: "kar hesaplarken siparişlerdeki gibi ... orda kurallar var").
  profitUsd: number;
  // Toplam alış maliyeti (adet × birim alış fiyatı) — profitUsd ile AYNI kaynaktan (getDailyProfitStats)
  // geliyor, aynı "sadece delivered" kısıtına tabi (2026-09-13, kullanıcı talebi: "toplam cost ekle").
  costUsd: number;
}

interface Totals {
  revenue: number;
  ordered_units: number;
  hits_view: number;
  hits_tocart: number;
  conv_tocart: number;
  returns: number;
  cancellations: number;
  profitUsd: number;
  costUsd: number;
}

interface TopProduct {
  offerId: string;
  name: string;
  image: string | null;
  revenueUsd: number;
  orderedUnits: number;
  href: string;
}

const RANGE_OPTIONS = [
  { label: "Bugün", days: 1 },
  { label: "Son 7 gün", days: 7 },
  { label: "Son 14 gün", days: 14 },
  { label: "Son 30 gün", days: 30 },
];

// "Genel Bakış" (görüntülenme/sepete ekleme gibi) Ozon'un analitik uç noktasından geliyor, o da
// revenue'yu HER ZAMAN RUB döner (bkz. src/ozon/analytics.ts) — API tarafında dolara çevrildi,
// çevrilemediği nadir durumda (kur çekilemedi) ham RUB olarak kalır, o yüzden burada da hangi para
// biriminde olduğu ayrıca belirtiliyor (2026-09-11, kullanıcı talebi: "ciroyu ruble gösteriyor
// dolar yap").
function fmtRevenue(n: number, currency: "USD" | "RUB"): string {
  const symbol = currency === "USD" ? "$" : "₽";
  return `${symbol}${n.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("tr-TR");
}

// Basit, tek seri (günlük ciro) çubuk grafik — inline SVG, hover'da tarih+değer+sipariş/ürün adedi
// gösterir. Bir çubuğa tıklamak o günü "seçili" yapar (bkz. AnalyticsView'daki selectedDate) —
// üst özet kartları ve "En Çok Satan Ürünler" o güne göre güncellenir, aynı çubuğa tekrar
// tıklamak seçimi kaldırır (2026-09-12, kullanıcı talebi). Tek seri olduğu için legend gerekmiyor
// (başlık zaten seriyi adlandırıyor).
function RevenueBarChart({
  days,
  currency,
  selectedDate,
  onSelectDate,
}: {
  days: DayRow[];
  currency: "USD" | "RUB";
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
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
          const isSelected = d.date === selectedDate;
          const fill = isSelected ? "var(--success)" : isHovered ? "var(--accent-hover)" : "var(--accent)";
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, 1)}
                rx={3}
                fill={fill}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
                onClick={() => onSelectDate(d.date)}
                style={{ cursor: "pointer" }}
              />
              {/* Görünmez, tam yükseklikte hit-target — küçük çubuklarda da hover/tıklama kolay tetiklensin */}
              <rect
                x={padding.left + i * slotW}
                y={padding.top}
                width={slotW}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
                onClick={() => onSelectDate(d.date)}
                style={{ cursor: "pointer" }}
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
          <strong>{fmtRevenue(days[hoverIndex].revenue, currency)}</strong>
          <div className="hint" style={{ margin: 0 }}>
            {fmtNum(days[hoverIndex].orderCount)} sipariş · {fmtNum(days[hoverIndex].unitsSold)} ürün
          </div>
          <div className="hint" style={{ margin: 0, color: days[hoverIndex].profitUsd < 0 ? "var(--danger)" : undefined }}>
            Kâr: {fmtUsd(days[hoverIndex].profitUsd)}
          </div>
        </div>
      )}
    </div>
  );
}

export function AnalyticsView() {
  const [rangeDays, setRangeDays] = useState(14);
  // Elle seçilen tek tarih ya da tarih aralığı — doluysa rangeDays'in yerini alır (2026-09-13,
  // kullanıcı talebi: "gün filtresi ekle tek tarih ya da tarih aralığı"). Tek tarih, from===to
  // olan bir aralık olarak modelleniyor — ayrı bir "tek gün modu" eklemeye gerek yok, kullanıcı
  // ikinci tarihi boş bırakırsa zaten ilkiyle aynı kabul ediliyor.
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [customFromInput, setCustomFromInput] = useState("");
  const [customToInput, setCustomToInput] = useState("");
  const [days, setDays] = useState<DayRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [revenueCurrency, setRevenueCurrency] = useState<"USD" | "RUB">("USD");
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [products, setProducts] = useState<TopProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productSearchInput, setProductSearchInput] = useState("");
  const [productQuery, setProductQuery] = useState("");

  // Grafikte bir güne tıklanınca o günü "seçili" yapar — üst özet kartları ve "En Çok Satan
  // Ürünler" artık 7/14/30 günlük aralık yerine SADECE bu güne göre gösterilir; aynı güne tekrar
  // tıklamak (ya da "Son 7/14/30 gün" butonlarından birine geçmek) seçimi temizler (2026-09-12,
  // kullanıcı talebi).
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // "Bugün/Son 7/14/30 gün" aralığı — DİKKAT: sunucu ya da tarayıcının kendi saat dilimi ne olursa
  // olsun, Türkiye takvim gününe göre hesaplanıyor (istanbulDateStr, bkz. utils/dateTr.ts). Önceden
  // burada tarayıcının UTC gününü (toISOString) kullanan bir hesap vardı — İstanbul saatiyle UTC
  // arasındaki 3 saatlik fark yüzünden gece yarısı ile sabah 03:00 arasında "bugün" bir gün eksik
  // hesaplanıyordu; bu hem "Bugün" filtresi hem de mevcut "Son 7/14/30 gün" aralıkları için
  // düzeltildi (2026-09-12, kullanıcı talebi: "Bugün" sekmesi Türkiye saatine göre olsun).
  const { from, to } = useMemo(() => {
    if (customRange) return customRange;
    const now = new Date();
    const fromDate = new Date(now.getTime() - (rangeDays - 1) * 24 * 60 * 60 * 1000);
    return { from: istanbulDateStr(fromDate), to: istanbulDateStr(now) };
  }, [rangeDays, customRange]);

  // Bir gün seçiliyken özet kartları o günün satırından (days içindeki DayRow) türetiliyor — ayrı
  // bir API isteğine gerek yok, zaten mevcut aralık için çekilmiş günlük veri içinde duruyor.
  const effectiveTotals: Totals | null = selectedDate ? (days.find((d) => d.date === selectedDate) ?? null) : totals;
  // "En Çok Satan Ürünler" ise ayrı bir uç noktadan geldiği için (bkz. aşağıdaki effect) seçili
  // günün from/to'su olarak kendi tarihini kullanır.
  const productsFrom = selectedDate ?? from;
  const productsTo = selectedDate ?? to;

  // "Genel Bakış" (görüntülenme/sepete ekleme vb.) Ozon'un kendi analitik uç noktasından geliyor,
  // o hâlâ 429 (rate limit) verebilir — bu yüzden ayrı bir yükleme/hata durumu var, "En Çok Satan
  // Ürünler" (artık local veriden, Ozon'a hiç gitmiyor) bundan ETKİLENMESİN diye (2026-09-11,
  // kullanıcı talebi: önceden ikisi TEK bir hata durumunu paylaşıyordu, biri başarısız olunca
  // diğeri başarılı olsa bile hiç gösterilmiyordu).
  useEffect(() => {
    setOverviewLoading(true);
    setOverviewError(null);
    fetch(`/api/analytics/overview?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((overview) => {
        if (overview.error) {
          setOverviewError(overview.error);
          return;
        }
        setDays(overview.days ?? []);
        setTotals(overview.totals ?? null);
        setRevenueCurrency(overview.revenueCurrency === "RUB" ? "RUB" : "USD");
      })
      .catch((err) => setOverviewError(err instanceof Error ? err.message : "Bilinmeyen hata"))
      .finally(() => setOverviewLoading(false));
  }, [from, to]);

  useEffect(() => {
    setProductsLoading(true);
    setProductsError(null);
    const q = productQuery ? `&q=${encodeURIComponent(productQuery)}` : "";
    fetch(`/api/analytics/products?from=${productsFrom}&to=${productsTo}&limit=15${q}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setProductsError(data.error);
          return;
        }
        setProducts(data.items ?? []);
      })
      .catch((err) => setProductsError(err instanceof Error ? err.message : "Bilinmeyen hata"))
      .finally(() => setProductsLoading(false));
  }, [productsFrom, productsTo, productQuery]);

  return (
    <div className="card">
      <div className="filter-bar">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.days}
            type="button"
            className={`btn-secondary${!selectedDate && !customRange && rangeDays === opt.days ? " active" : ""}`}
            onClick={() => {
              setRangeDays(opt.days);
              setCustomRange(null);
              // Aralık butonlarından biri seçilince, grafikteki gün seçimini temizle — aksi halde
              // yeni aralığın dışında kalmış eski bir gün seçili görünmeye devam ederdi.
              setSelectedDate(null);
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Elle tarih filtresi — ikinci alan boş bırakılırsa tek günlük bir aralık olarak
          uygulanıyor (2026-09-13, kullanıcı talebi). */}
      <div className="filter-bar" style={{ marginTop: 8, alignItems: "center" }}>
        <input
          type="date"
          value={customFromInput}
          onChange={(e) => setCustomFromInput(e.target.value)}
          aria-label="Başlangıç tarihi"
        />
        <span className="hint">–</span>
        <input
          type="date"
          value={customToInput}
          onChange={(e) => setCustomToInput(e.target.value)}
          aria-label="Bitiş tarihi (boş bırakılırsa tek gün)"
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={!customFromInput}
          onClick={() => {
            setCustomRange({ from: customFromInput, to: customToInput || customFromInput });
            setSelectedDate(null);
          }}
        >
          Uygula
        </button>
        {customRange && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setCustomRange(null);
              setCustomFromInput("");
              setCustomToInput("");
            }}
          >
            Temizle
          </button>
        )}
      </div>

      {overviewLoading ? (
        <div className="hint">Yükleniyor...</div>
      ) : overviewError ? (
        <div className="hint" style={{ color: "var(--danger)" }}>
          {overviewError}
        </div>
      ) : (
        <>
          {effectiveTotals && (
            <div className="summary-grid" style={{ marginBottom: 24 }}>
              <div>
                <div className="hint">Toplam Ciro</div>
                <div className="value">{fmtRevenue(effectiveTotals.revenue, revenueCurrency)}</div>
              </div>
              <div>
                <div className="hint">Toplam Kâr</div>
                <div className="value" style={{ color: effectiveTotals.profitUsd < 0 ? "var(--danger)" : undefined }}>
                  {fmtUsd(effectiveTotals.profitUsd)}
                </div>
              </div>
              <div>
                <div className="hint">Toplam Maliyet</div>
                <div className="value">{fmtUsd(effectiveTotals.costUsd)}</div>
              </div>
              <div>
                <div className="hint">Sipariş Adedi</div>
                <div className="value">{fmtNum(effectiveTotals.ordered_units)}</div>
              </div>
              <div>
                <div className="hint">Görüntülenme</div>
                <div className="value">{fmtNum(effectiveTotals.hits_view)}</div>
              </div>
              <div>
                <div className="hint">Sepete Ekleme</div>
                <div className="value">{fmtNum(effectiveTotals.hits_tocart)}</div>
              </div>
              <div>
                <div className="hint">Sepete Ekleme Oranı</div>
                <div className="value">%{effectiveTotals.conv_tocart.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}</div>
              </div>
              <div>
                <div className="hint">İade</div>
                <div className="value" style={{ color: effectiveTotals.returns > 0 ? "var(--danger)" : undefined }}>
                  {fmtNum(effectiveTotals.returns)}
                </div>
              </div>
              <div>
                <div className="hint">İptal</div>
                <div className="value" style={{ color: effectiveTotals.cancellations > 0 ? "var(--danger)" : undefined }}>
                  {fmtNum(effectiveTotals.cancellations)}
                </div>
              </div>
            </div>
          )}

          <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong>Günlük Ciro</strong>
            {selectedDate && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedDate(null)}
                style={{ fontSize: 12, padding: "2px 8px" }}
                title="Gün seçimini temizle ve genel aralığa dön"
              >
                {selectedDate} seçili ✕
              </button>
            )}
          </div>
          {days.length > 0 ? (
            <RevenueBarChart
              days={days}
              currency={revenueCurrency}
              selectedDate={selectedDate}
              onSelectDate={(date) => setSelectedDate((prev) => (prev === date ? null : date))}
            />
          ) : (
            <div className="hint">Bu tarih aralığında veri yok.</div>
          )}
        </>
      )}

      <div style={{ marginTop: 32, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <strong>En Çok Satan Ürünler</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={productSearchInput}
            onChange={(e) => setProductSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setProductQuery(productSearchInput.trim());
            }}
            placeholder="Ürün adı ya da SKU ara..."
            style={{ minWidth: 240 }}
          />
          <button className="btn-secondary" onClick={() => setProductQuery(productSearchInput.trim())}>
            Ara
          </button>
          {productQuery && (
            <button
              className="btn-secondary"
              onClick={() => {
                setProductSearchInput("");
                setProductQuery("");
              }}
            >
              Temizle
            </button>
          )}
        </div>
      </div>
      {/* Bu tablo artık Ozon'un analitik uç noktasına (429/rate-limit'e sık takılan) değil, bizim
          local sipariş verimize bağlı — bkz. orders.service.ts getTopSellingProducts (2026-09-11,
          kullanıcı talebi) — bu yüzden Genel Bakış'tan bağımsız kendi yükleme/hata durumunu kullanıyor. */}
      {productsLoading ? (
        <div className="hint">Yükleniyor...</div>
      ) : productsError ? (
        <div className="hint" style={{ color: "var(--danger)" }}>
          {productsError}
        </div>
      ) : products.length === 0 ? (
        <div className="empty-state">
          {productQuery ? `"${productQuery}" için sonuç bulunamadı.` : "Bu tarih aralığında satış yok."}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Ürün</th>
              <th>Ciro ($)</th>
              <th>Adet</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.offerId}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {p.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image}
                        alt=""
                        width={32}
                        height={32}
                        style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
                      />
                    )}
                    <Link href={p.href}>{p.name || p.offerId}</Link>
                  </div>
                </td>
                <td>{fmtUsd(p.revenueUsd)}</td>
                <td>{fmtNum(p.orderedUnits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
