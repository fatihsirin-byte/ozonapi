"use client";

import { useEffect, useState } from "react";

interface VariantTierView {
  tier: string;
  itemPerPackage: number;
  sku: string;
  barcode: string;
  stockAvailable: number;
  stockOverride: number | null;
  costUsd: number;
  sellingPriceTl: number;
  sendable: boolean;
  approved: boolean;
}

interface ToptantrListing {
  id: string;
  shopifyHandle: string;
  toptantrProductId: string | null;
  categoryGuid: string | null;
  brandGuid: string | null;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
}

interface Preview {
  listing: ToptantrListing | null;
  variants: VariantTierView[];
  priceAnomaly: boolean;
  isSingleUnitOnly: boolean;
  suggestedMapping: { categoryGuid: string | null; brandGuid: string | null } | null;
}

interface GuidOption {
  guid: string;
  name?: string;
  breadcrumb?: string;
}

function GuidPicker({
  label,
  placeholder,
  endpoint,
  selectedGuid,
  selectedLabel,
  onSelect,
}: {
  label: string;
  placeholder: string;
  endpoint: string;
  selectedGuid: string | null;
  selectedLabel: string | null;
  onSelect: (guid: string | null, label: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GuidOption[]>([]);
  // API hatası (ör. TOPTANTR_USERNAME/PASSWORD eksikse) önceden sessizce boş sonuç listesine
  // düşüyordu — "arıyorum ama hiç sonuç çıkmıyor" diye tanısı zor bir belirtiye yol açıyordu
  // (2026-09-27, kullanıcı bulgusu). Artık hata metni doğrudan gösteriliyor.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`${endpoint}?q=${encodeURIComponent(query)}`)
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error ?? "Arama başarısız");
          return data;
        })
        .then((data) => {
          setResults(data.results ?? []);
          setError(null);
        })
        .catch((err) => {
          setResults([]);
          setError(err.message);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, endpoint]);

  if (selectedGuid) {
    return (
      <div className="field">
        <label>{label}</label>
        <div className="selected-pill">
          <strong>{selectedLabel ?? selectedGuid}</strong>
          <button type="button" className="btn-secondary" onClick={() => onSelect(null, null)}>
            Değiştir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} />
      {error && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
      {results.length > 0 && (
        <div className="search-results">
          {results.map((r) => (
            <div
              key={r.guid}
              className="search-result-item"
              onClick={() => {
                onSelect(r.guid, r.breadcrumb ?? r.name ?? r.guid);
                setQuery("");
                setResults([]);
              }}
            >
              {r.breadcrumb ?? r.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToptantrPanel({ handle }: { handle: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoryGuid, setCategoryGuid] = useState<string | null>(null);
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null);
  const [brandGuid, setBrandGuid] = useState<string | null>(null);
  const [brandLabel, setBrandLabel] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => {
    setError(null);
    fetch(`/api/import/products/${encodeURIComponent(handle)}/toptantr`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Yüklenemedi");
        return data as Preview;
      })
      .then((data) => {
        setPreview(data);
        if (data.listing?.categoryGuid) setCategoryGuid(data.listing.categoryGuid);
        else if (data.suggestedMapping?.categoryGuid) setCategoryGuid(data.suggestedMapping.categoryGuid);
        if (data.listing?.brandGuid) setBrandGuid(data.listing.brandGuid);
        else if (data.suggestedMapping?.brandGuid) setBrandGuid(data.suggestedMapping.brandGuid);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(load, [handle]);

  async function toggleApproved(sku: string, approved: boolean) {
    setPreview((prev) =>
      prev ? { ...prev, variants: prev.variants.map((v) => (v.sku === sku ? { ...v, approved } : v)) } : prev,
    );
    await fetch(`/api/import/variant/${encodeURIComponent(sku)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toptantrApproved: approved }),
    });
  }

  // Elle kademe stoğu: boş bırakılırsa null (otomatik: floor(tekli stok / adet)). Adet kademesi
  // her zaman gerçek tekli stoğu yansıttığı için input sadece Paket/Koli/Palet'te gösteriliyor.
  async function saveOverride(sku: string, raw: string) {
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      setError("Stok 0 veya pozitif tam sayı olmalı");
      return;
    }
    setError(null);
    const res = await fetch(`/api/import/variant/${encodeURIComponent(sku)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toptantrStockOverride: value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Stok kaydedilemedi");
      return;
    }
    load();
  }

  async function connect() {
    if (!categoryGuid) return;
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}/toptantr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryGuid, brandGuid }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Bağlanamadı");
        return;
      }
      load();
    } finally {
      setConnecting(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}/toptantr/refresh`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Yenilenemedi");
        return;
      }
      load();
    } finally {
      setRefreshing(false);
    }
  }

  if (!preview) {
    return <div className="card">{error ? <span style={{ color: "var(--danger)" }}>{error}</span> : "Yükleniyor..."}</div>;
  }

  const listing = preview.listing;
  const isConnected = listing?.status === "success";
  const approvedCount = preview.variants.filter((v) => v.approved).length;

  return (
    <div className="card">
      <label>toptantr Bağlantısı</label>

      {preview.isSingleUnitOnly && (
        <div className="hint" style={{ color: "var(--danger)" }}>
          Bu ürün tek parçalık (tekli) bir perakende ürünü — toptantr toptan pazaryeri olduğundan gönderilemez.
        </div>
      )}

      {listing && (
        <div className="hint" style={{ marginBottom: 12 }}>
          Durum: <span className={`badge ${listing.status}`}>{listing.status}</span>
          {listing.lastSyncedAt && ` · son senkron: ${new Date(listing.lastSyncedAt).toLocaleString("tr-TR")}`}
          {listing.lastError && (
            <div style={{ color: "var(--danger)", marginTop: 4 }}>{listing.lastError}</div>
          )}
        </div>
      )}

      <table style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Onay</th>
            <th>Kademe</th>
            <th>SKU</th>
            <th>Adet/Paket</th>
            <th>Stok</th>
            <th>Elle stok</th>
            <th>Satış (TL)</th>
          </tr>
        </thead>
        <tbody>
          {preview.variants.map((v) => (
            <tr key={v.sku} style={!v.sendable ? { opacity: 0.5 } : undefined}>
              <td style={{ textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={v.approved}
                  disabled={!v.sendable}
                  onChange={(e) => toggleApproved(v.sku, e.target.checked)}
                />
              </td>
              <td>{v.tier}</td>
              <td>{v.sku}</td>
              <td>{v.itemPerPackage}</td>
              <td>{v.stockAvailable}</td>
              <td>
                {v.tier !== "Adet" && (
                  <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="otomatik"
                    style={{ width: 90 }}
                    defaultValue={v.stockOverride ?? ""}
                    key={`${v.sku}:${v.stockOverride ?? ""}`}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== String(v.stockOverride ?? "")) saveOverride(v.sku, e.target.value);
                    }}
                  />
                )}
              </td>
              <td>{v.sellingPriceTl.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!preview.variants.some((v) => v.sendable) && (
        <div className="hint">Gönderilebilir (tekli olmayan) hiçbir kademe yok — bkz. yukarıdaki soluk satırlar.</div>
      )}
      {preview.priceAnomaly && (
        <div className="hint" style={{ color: "var(--danger)", marginBottom: 12 }}>
          Fiyat anomalisi: büyük kademe (Koli/Palet), küçük kademeden birim başına daha pahalı görünüyor — Shopify
          maliyet verisini kontrol edin.
        </div>
      )}

      <GuidPicker
        label="Kategori"
        placeholder="Kategori ara..."
        endpoint="/api/toptantr/categories"
        selectedGuid={categoryGuid}
        selectedLabel={categoryLabel}
        onSelect={(guid, label) => {
          setCategoryGuid(guid);
          setCategoryLabel(label);
        }}
      />
      <GuidPicker
        label="Marka (opsiyonel)"
        placeholder="Marka ara..."
        endpoint="/api/toptantr/brands"
        selectedGuid={brandGuid}
        selectedLabel={brandLabel}
        onSelect={(guid, label) => {
          setBrandGuid(guid);
          setBrandLabel(label);
        }}
      />

      {error && <div className="hint" style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div>}

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        {!isConnected ? (
          <button className="btn-primary" disabled={!categoryGuid || approvedCount === 0 || connecting} onClick={connect}>
            {connecting ? "Bağlanıyor..." : "toptantr'a Bağla"}
          </button>
        ) : (
          <button className="btn-secondary" disabled={refreshing} onClick={refresh}>
            {refreshing ? "Yenileniyor..." : "Stok/Fiyatı Yenile"}
          </button>
        )}
      </div>
      {!categoryGuid && <div className="hint" style={{ marginTop: 8 }}>Bağlamak için önce bir kategori seçin.</div>}
      {approvedCount === 0 && <div className="hint">Göndermek istediğiniz en az bir kademeyi (Adet/Paket/Koli/Palet) onaylayın.</div>}
    </div>
  );
}
