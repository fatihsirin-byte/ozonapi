"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PriceCalculatorModal } from "../products/[offerId]/PriceCalculatorModal";

interface PriceIndexData {
  minimal_price: string;
  minimal_price_currency: string;
  price_index_value: number;
}

interface PriceIndex {
  color_index: "COLOR_INDEX_GREEN" | "COLOR_INDEX_YELLOW" | "COLOR_INDEX_RED" | "COLOR_INDEX_WITHOUT_INDEX";
  external_index_data: PriceIndexData;
  ozon_index_data: PriceIndexData;
  self_marketplaces_index_data: PriceIndexData;
}

interface PriceProduct {
  offerId: string;
  name: string;
  images: unknown;
  price: string;
  costPrice: string | null;
  oldPrice: string | null;
  weightGrams: number | null;
  cargoWeightGrams: number | null;
  heavyPackaging: boolean;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  priceIndex?: PriceIndex | null;
}

// Ozon'un renklendirdiği referans fiyat verisinden (ozon_index_data öncelikli, o boşsa
// external) minimal_price'ı ve para birimini seçer — hangisi doluysa o gösterilir.
function pickReference(idx: PriceIndex): PriceIndexData | null {
  if (idx.ozon_index_data?.minimal_price) return idx.ozon_index_data;
  if (idx.external_index_data?.minimal_price) return idx.external_index_data;
  if (idx.self_marketplaces_index_data?.minimal_price) return idx.self_marketplaces_index_data;
  return null;
}

function competitivenessBadge(idx?: PriceIndex | null) {
  if (!idx || idx.color_index === "COLOR_INDEX_WITHOUT_INDEX") {
    return <span className="hint">Karşılaştırma yok</span>;
  }
  const ref = pickReference(idx);
  const color =
    idx.color_index === "COLOR_INDEX_GREEN"
      ? "var(--success)"
      : idx.color_index === "COLOR_INDEX_RED"
        ? "var(--danger)"
        : "#e0a940"; // yellow — CSS değişkenlerinde tanımlı değil, tek kullanım için sabit
  const label = idx.color_index === "COLOR_INDEX_GREEN" ? "Rekabetçi" : idx.color_index === "COLOR_INDEX_RED" ? "Pahalı" : "Ortalama";
  return (
    <div>
      <span style={{ color, fontWeight: 600 }}>● {label}</span>
      {ref && (
        <div className="hint" style={{ margin: 0 }}>
          Piyasa: {ref.minimal_price_currency === "RUB" ? "₽" : "$"}
          {Number(ref.minimal_price).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 25;

// StagingList.tsx'teki (/import) ile birebir aynı desen — arama debounce + sayfa/arama
// durumunun URL'e yazılması (geri tuşunda kaldığın filtrede/sayfada kal).
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function PriceList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [page, setPage] = useState(() => Number(searchParams.get("page")) || 1);
  const [items, setItems] = useState<PriceProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [activeOfferId, setActiveOfferId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (targetPage: number, q: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/products?${params.toString()}`);
    const data = await res.json();
    setItems(data.items ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, []);

  const skipFilterResetRef = useRef(true);
  useEffect(() => {
    if (skipFilterResetRef.current) {
      skipFilterResetRef.current = false;
      load(page, debouncedSearch);
      return;
    }
    setPage(1);
    load(1, debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    if (page === 1) return;
    load(page, debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const active = items.find((i) => i.offerId === activeOfferId) ?? null;

  async function applyPrice(priceUsd: string) {
    if (!active) return;
    setSaving(true);
    try {
      await fetch(`/api/products/${encodeURIComponent(active.offerId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costPrice: active.costPrice, priceOverride: priceUsd, heavyPackaging: active.heavyPackaging }),
      });
      setActiveOfferId(null);
      await load(page, debouncedSearch);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="filter-bar">
        <input type="text" placeholder="Ürün adı veya SKU ara..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="hint">Yükleniyor...</div>
      ) : items.length === 0 ? (
        <div className="empty-state">{search ? "Bu aramayla eşleşen ürün yok." : "Henüz Ozon'a bağlı ürün yok."}</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Görsel</th>
              <th>Ürün</th>
              <th>Rekabet</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const images = Array.isArray(item.images) ? (item.images as string[]) : [];
              return (
                <tr key={item.offerId} style={{ cursor: "pointer" }} onClick={() => setActiveOfferId(item.offerId)}>
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
                  <td>
                    {item.name}
                    <div className="hint" style={{ margin: 0 }}>
                      {item.offerId}
                    </div>
                  </td>
                  <td>{competitivenessBadge(item.priceIndex)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
          <button className="btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            ← Önceki
          </button>
          <span className="hint" style={{ alignSelf: "center" }}>
            Sayfa {page} / {totalPages}
          </span>
          <button className="btn-secondary" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
            Sonraki →
          </button>
        </div>
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
          currentPrice={active.price}
          onClose={() => !saving && setActiveOfferId(null)}
          onApply={applyPrice}
        />
      )}
    </div>
  );
}
