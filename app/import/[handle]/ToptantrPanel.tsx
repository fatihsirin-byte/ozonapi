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
  translatedTitle: string | null;
  shortDescription: string | null;
  fullDescription: string | null;
}

interface ManualTier {
  tier: "Paket" | "Koli";
  itemPerPackage: number;
  stock: number;
}

interface Preview {
  listing: ToptantrListing | null;
  variants: VariantTierView[];
  priceAnomaly: boolean;
  isSingleUnitOnly: boolean;
  suggestedMapping: { categoryGuid: string | null; brandGuid: string | null } | null;
  manualTiers: ManualTier[];
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
  // Elle kademe formu (Paket = kutu/display, Koli) ve Türkçe metin düzenleyici
  const [tierForm, setTierForm] = useState({ paketIpp: "", paketStock: "", koliIpp: "", koliStock: "" });
  const [savingTiers, setSavingTiers] = useState(false);
  const [text, setText] = useState({ title: "", shortDescription: "", fullDescription: "" });
  const [textBusy, setTextBusy] = useState<null | "generate" | "save" | "push">(null);
  const [textMsg, setTextMsg] = useState<string | null>(null);

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
        const paket = data.manualTiers.find((t) => t.tier === "Paket");
        const koli = data.manualTiers.find((t) => t.tier === "Koli");
        setTierForm({
          paketIpp: paket ? String(paket.itemPerPackage) : "",
          paketStock: paket ? String(paket.stock) : "",
          koliIpp: koli ? String(koli.itemPerPackage) : "",
          koliStock: koli ? String(koli.stock) : "",
        });
        setText({
          title: data.listing?.translatedTitle ?? "",
          shortDescription: data.listing?.shortDescription ?? "",
          fullDescription: data.listing?.fullDescription ?? "",
        });
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

  async function saveTiers(clear = false) {
    const tiers: ManualTier[] = [];
    if (!clear) {
      if (tierForm.paketIpp.trim() !== "" || tierForm.paketStock.trim() !== "")
        tiers.push({ tier: "Paket", itemPerPackage: Number(tierForm.paketIpp), stock: Number(tierForm.paketStock) });
      if (tierForm.koliIpp.trim() !== "" || tierForm.koliStock.trim() !== "")
        tiers.push({ tier: "Koli", itemPerPackage: Number(tierForm.koliIpp), stock: Number(tierForm.koliStock) });
    }
    setSavingTiers(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}/toptantr/tiers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kademeler kaydedilemedi");
        return;
      }
      load();
    } finally {
      setSavingTiers(false);
    }
  }

  async function textRequest(kind: "generate" | "save" | "push") {
    setTextBusy(kind);
    setTextMsg(null);
    setError(null);
    try {
      const url = `/api/import/products/${encodeURIComponent(handle)}/toptantr/text`;
      const res =
        kind === "generate"
          ? await fetch(url, { method: "POST" })
          : await fetch(url, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...text, push: kind === "push" }),
            });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "İşlem başarısız");
        return;
      }
      if (kind === "generate") {
        setText({ title: data.title, shortDescription: data.shortDescription, fullDescription: data.fullDescription });
        setTextMsg("Türkçe metin üretildi ve kaydedildi — kontrol edip düzenleyebilirsiniz.");
      } else {
        setTextMsg(kind === "push" ? "Kaydedildi ve toptantr'a gönderildi." : "Kaydedildi.");
      }
    } finally {
      setTextBusy(null);
    }
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
  const hasManualTiers = preview.manualTiers.length > 0;
  const sendableCount = hasManualTiers ? preview.manualTiers.length : approvedCount;

  return (
    <div className="card">
      <label>toptantr Bağlantısı</label>

      {preview.isSingleUnitOnly && !hasManualTiers && (
        <div className="hint" style={{ color: "var(--danger)" }}>
          Bu ürün tek parçalık (tekli) bir perakende ürünü — toptantr toptan pazaryeri olduğundan, aşağıdan elle kademe
          (Paket/Koli) girmeden gönderilemez.
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

      <div style={{ marginBottom: 16 }}>
        <label>Elle kademe (kutu/display + koli)</label>
        <div className="hint" style={{ marginBottom: 8 }}>
          Sadece toptantr&apos;ın sabit kademeleri: <strong>Paket</strong> (kutu/display) ve <strong>Koli</strong>. Doluysa bu ürün için
          Shopify stoğu yerine bu adet ve stok toptantr&apos;a gider, otomatik stok senkronu bu ürüne dokunmaz. Fiyat = birim maliyet × paket içi adet.
        </div>
        <table>
          <thead>
            <tr>
              <th>Kademe</th>
              <th>Paket içi adet</th>
              <th>Stok</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Paket (kutu/display)", "paketIpp", "paketStock"],
                ["Koli", "koliIpp", "koliStock"],
              ] as const
            ).map(([label, ippKey, stockKey]) => (
              <tr key={ippKey}>
                <td>{label}</td>
                <td>
                  <input type="number" min={2} step={1} style={{ width: 100 }} value={tierForm[ippKey]} onChange={(e) => setTierForm({ ...tierForm, [ippKey]: e.target.value })} />
                </td>
                <td>
                  <input type="number" min={0} step={1} style={{ width: 100 }} value={tierForm[stockKey]} onChange={(e) => setTierForm({ ...tierForm, [stockKey]: e.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn-secondary" disabled={savingTiers} onClick={() => saveTiers(false)}>
            {savingTiers ? "Kaydediliyor..." : "Kademeleri Kaydet"}
          </button>
          {hasManualTiers && (
            <button type="button" className="btn-secondary" disabled={savingTiers} onClick={() => saveTiers(true)}>
              Elle kademeyi kaldır
            </button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label>Türkçe başlık ve açıklama</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" className="btn-secondary" disabled={textBusy !== null} onClick={() => textRequest("generate")}>
            {textBusy === "generate" ? "Yazılıyor..." : "Türkçeleştir (Gemini)"}
          </button>
        </div>
        <input type="text" placeholder="Başlık" value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })} />
        <textarea
          rows={3}
          placeholder="Kısa açıklama (en fazla 500 karakter)"
          style={{ width: "100%", marginTop: 8 }}
          value={text.shortDescription}
          onChange={(e) => setText({ ...text, shortDescription: e.target.value })}
        />
        <textarea
          rows={8}
          placeholder="Uzun açıklama (HTML, en fazla 4000 karakter)"
          style={{ width: "100%", marginTop: 8 }}
          value={text.fullDescription}
          onChange={(e) => setText({ ...text, fullDescription: e.target.value })}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn-secondary" disabled={textBusy !== null || !text.title.trim()} onClick={() => textRequest("save")}>
            {textBusy === "save" ? "Kaydediliyor..." : "Metni Kaydet"}
          </button>
          {isConnected && (
            <button type="button" className="btn-secondary" disabled={textBusy !== null || !text.title.trim()} onClick={() => textRequest("push")}>
              {textBusy === "push" ? "Gönderiliyor..." : "Kaydet ve toptantr'a gönder"}
            </button>
          )}
        </div>
        {textMsg && <div className="hint" style={{ marginTop: 6 }}>{textMsg}</div>}
      </div>

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
          <button className="btn-primary" disabled={!categoryGuid || sendableCount === 0 || connecting} onClick={connect}>
            {connecting ? "Bağlanıyor..." : "toptantr'a Bağla"}
          </button>
        ) : (
          <button className="btn-secondary" disabled={refreshing} onClick={refresh}>
            {refreshing ? "Yenileniyor..." : "Stok/Fiyatı Yenile"}
          </button>
        )}
      </div>
      {!categoryGuid && <div className="hint" style={{ marginTop: 8 }}>Bağlamak için önce bir kategori seçin.</div>}
      {sendableCount === 0 && <div className="hint">Göndermek istediğiniz en az bir kademeyi (Adet/Paket/Koli/Palet) onaylayın ya da elle kademe girin.</div>}
    </div>
  );
}
