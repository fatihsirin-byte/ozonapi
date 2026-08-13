"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { PriceCalculatorModal } from "../../products/[offerId]/PriceCalculatorModal";

interface OzonAction {
  id: number;
  title: string;
  date_start: string;
  date_end: string;
  potential_products_count: number;
  participating_products_count: number;
}

interface ActionProduct {
  id: number; // Ozon product_id
  price: number;
  action_price: number;
  price_min_elastic?: number;
  price_max_elastic?: number;
  min_boost?: number;
  max_boost?: number;
  current_boost?: number;
  offerId: string | null;
  name: string;
  images: unknown;
  costPrice: string | null;
  weightGrams: number | null;
  cargoWeightGrams: number | null;
  heavyPackaging: boolean;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR");
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Ozon'un Seller API'si sadece iki uç nokta veriyor (price_min_elastic/price_max_elastic +
// min_boost/max_boost) — panelde görülen ara basamaklar (ör. 15/30/45) API'de yok, muhtemelen
// Ozon'un kendi arayüzü bu iki uç arasını kendi hesaplıyor. Burada da aynı şekilde DÜZ ORANTILI
// (lineer) ara basamak TAHMİNİ üretiyoruz — Ozon'un gerçekte kullandığı algoritma bu olmayabilir,
// bu yüzden UI'da açıkça "≈ tahmini" diye işaretleniyor (2026-08-14, kullanıcı talebi).
interface BoostStep {
  price: number;
  boost: number;
}

function estimateBoostSteps(product: ActionProduct, count = 5): BoostStep[] {
  const { price_min_elastic, price_max_elastic, min_boost, max_boost } = product;
  if (price_min_elastic == null || price_max_elastic == null || min_boost == null || max_boost == null) return [];
  const lowPrice = Math.min(price_min_elastic, price_max_elastic); // en derin indirim
  const highPrice = Math.max(price_min_elastic, price_max_elastic); // en sığ indirim (normale en yakın)
  const steps: BoostStep[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const price = highPrice - t * (highPrice - lowPrice);
    const boost = min_boost + t * (max_boost - min_boost);
    steps.push({ price, boost: Math.round(boost) });
  }
  return steps;
}

export function ActionDetail({ actionId }: { actionId: number }) {
  const [action, setAction] = useState<OzonAction | null>(null);
  const [tab, setTab] = useState<"participating" | "candidates">("participating");
  const [products, setProducts] = useState<ActionProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [activeProductId, setActiveProductId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/actions")
      .then((r) => r.json())
      .then((data) => setAction((data.actions ?? []).find((a: OzonAction) => a.id === actionId) ?? null));
  }, [actionId]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/actions/${actionId}/products?type=${tab}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setProducts(data.products ?? []);
      })
      .finally(() => setLoading(false));
  }, [actionId, tab]);

  useEffect(() => {
    load();
  }, [load]);

  const active = products.find((p) => p.id === activeProductId) ?? null;

  // Fiyat Hesaplayıcı'daki "Bu Fiyatı Kullan" — hem yeni ürünü aksiyona ekler (aday sekmesi)
  // hem de zaten katılan bir ürünün aksiyon fiyatını GÜNCELLER (katılan sekmesi) — Ozon'un
  // activate uç noktası zaten katılan bir ürün için tekrar çağrılırsa fiyatı günceller.
  async function applyActionPrice(priceUsd: string) {
    if (!active) return;
    setBusyId(active.id);
    try {
      const res = await fetch(`/api/actions/${actionId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: active.id, actionPrice: Number(priceUsd) }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "İşlem başarısız");
        return;
      }
      setActiveProductId(null);
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function deactivate(product: ActionProduct) {
    if (!confirm(`"${product.name}" bu aksiyondan çıkarılacak. Devam edilsin mi?`)) return;
    setBusyId(product.id);
    try {
      await fetch(`/api/actions/${actionId}/products`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      {action && (
        <div style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 18 }}>{action.title}</strong>
          <div className="hint" style={{ margin: 0 }}>
            {fmtDate(action.date_start)} — {fmtDate(action.date_end)}
          </div>
        </div>
      )}

      <div className="filter-bar">
        <button
          type="button"
          className={`btn-secondary${tab === "participating" ? " active" : ""}`}
          onClick={() => setTab("participating")}
        >
          Katılan Ürünler ({action?.participating_products_count ?? 0})
        </button>
        <button
          type="button"
          className={`btn-secondary${tab === "candidates" ? " active" : ""}`}
          onClick={() => setTab("candidates")}
        >
          Aday Ürünler ({action?.potential_products_count ?? 0})
        </button>
      </div>

      {tab === "candidates" && (
        <div className="hint" style={{ marginBottom: 12 }}>
          Bir ürüne tıklayınca Fiyat Hesaplayıcı açılır — alış/kâr/marj görüp uygun bir aksiyon fiyatı belirleyip
          "Bu Fiyatı Kullan" ile aksiyona ekleyebilirsin.
        </div>
      )}

      {loading ? (
        <div className="hint">Yükleniyor...</div>
      ) : error ? (
        <div className="hint" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      ) : products.length === 0 ? (
        <div className="empty-state">Bu listede ürün yok.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Görsel</th>
              <th>Ürün</th>
              <th>Normal Fiyat</th>
              {tab === "participating" ? <th>Aksiyon Fiyatı</th> : <th>İzin Verilen Aralık</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const images = Array.isArray(p.images) ? (p.images as string[]) : [];
              const canCalculate = !!p.costPrice;
              const steps = estimateBoostSteps(p);
              const isExpanded = expandedId === p.id;
              return (
                <Fragment key={p.id}>
                  <tr>
                    <td>
                      {images[0] ? (
                        <img
                          src={images[0]}
                          alt=""
                          className="zoom-thumb"
                          style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }}
                        />
                      ) : (
                        <div style={{ width: 56, height: 56, borderRadius: 6, background: "#1a1e24" }} />
                      )}
                    </td>
                    <td
                      style={canCalculate ? { cursor: "pointer" } : undefined}
                      onClick={() => canCalculate && setActiveProductId(p.id)}
                    >
                      {p.name}
                      {!canCalculate && <div className="hint" style={{ margin: 0 }}>Yerel ürün bulunamadı — hesaplayıcı yok</div>}
                    </td>
                    <td>{fmtUsd(p.price)}</td>
                    {tab === "participating" ? (
                      <td>{fmtUsd(p.action_price)}</td>
                    ) : (
                      <td>
                        {p.price_min_elastic != null && p.price_max_elastic != null
                          ? `${fmtUsd(Math.min(p.price_min_elastic, p.price_max_elastic))} — ${fmtUsd(Math.max(p.price_min_elastic, p.price_max_elastic))}`
                          : <span className="hint">—</span>}
                      </td>
                    )}
                    <td style={{ display: "flex", gap: 8 }}>
                      {steps.length > 0 && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
                        >
                          {isExpanded ? "Gizle" : "Basamaklar"}
                        </button>
                      )}
                      {tab === "participating" && (
                        <button type="button" className="btn-secondary" disabled={busyId === p.id} onClick={() => deactivate(p)}>
                          {busyId === p.id ? "..." : "Çıkar"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td></td>
                      <td colSpan={4}>
                        <div className="hint" style={{ marginBottom: 6 }}>
                          ≈ Tahmini basamaklar — Ozon'un panelinde gördüğün ayrı seçenekler API'de yok, min/max
                          aralığından düz orantılı hesaplandı, gerçek değerlerle birebir aynı olmayabilir.
                        </div>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                          {steps.map((s, i) => (
                            <div
                              key={i}
                              style={{
                                background: "#0f1216",
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: "8px 12px",
                                cursor: canCalculate ? "pointer" : undefined,
                              }}
                              onClick={() => {
                                if (!canCalculate) return;
                                setActiveProductId(p.id);
                                setExpandedId(null);
                              }}
                            >
                              <div className="hint" style={{ margin: 0 }}>Boost ≈%{s.boost}</div>
                              <strong>{fmtUsd(s.price)}</strong>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {active && (
        <PriceCalculatorModal
          costPrice={active.costPrice ?? ""}
          weightGrams={active.weightGrams}
          widthCm={active.widthCm}
          heightCm={active.heightCm}
          depthCm={active.depthCm}
          heavyPackaging={active.heavyPackaging}
          cargoWeightGrams={active.cargoWeightGrams}
          currentPrice={tab === "participating" ? String(active.action_price) : ""}
          onClose={() => busyId !== active.id && setActiveProductId(null)}
          onApply={applyActionPrice}
        />
      )}
    </div>
  );
}
