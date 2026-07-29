"use client";

import { useState } from "react";
import { ImageDropzone } from "../new/ImageDropzone";
import { TEMP_MARKUP, computeSalePrice } from "@/pricing/formula";

interface ProductData {
  offerId: string;
  name: string;
  price: string;
  costPrice: string | null;
  currencyCode: string;
  status: string;
  ozonProductId: string | null;
  lastError: string | null;
  images: unknown;
  weightGrams: number | null;
}

const TABS = ["Genel", "Fiyat", "Görseller"] as const;
type Tab = (typeof TABS)[number];

export function ProductEditForm({ product }: { product: ProductData }) {
  const [tab, setTab] = useState<Tab>("Genel");
  const [costPrice, setCostPrice] = useState(product.costPrice ?? "");
  const [images, setImages] = useState<string[]>(Array.isArray(product.images) ? (product.images as string[]) : []);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(product.status);
  const [lastError, setLastError] = useState(product.lastError);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function pollUntilResolved() {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/products/${product.offerId}/status`);
      const data = await res.json();
      if (data.status !== "pending") {
        clearInterval(interval);
        setStatus(data.status);
        setLastError(data.error);
        setMessage(
          data.status === "imported"
            ? { type: "success", text: "Ozon'da başarıyla güncellendi." }
            : { type: "error", text: data.error ?? "Güncelleme başarısız" },
        );
      }
    }, 3000);
  }

  async function savePrice() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/products/${product.offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costPrice }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Güncelleme başarısız" });
        return;
      }
      setMessage({ type: "success", text: "Fiyat Ozon'a kaydedildi." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Bilinmeyen hata" });
    } finally {
      setSaving(false);
    }
  }

  async function saveImages() {
    setSaving(true);
    setMessage(null);
    setStatus("pending");
    try {
      const res = await fetch(`/api/products/${product.offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Güncelleme başarısız" });
        setStatus(product.status);
        return;
      }
      setMessage({ type: "success", text: "Görseller gönderildi, Ozon işliyor..." });
      pollUntilResolved();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Bilinmeyen hata" });
      setStatus(product.status);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="field">
        <label>SKU</label>
        {product.offerId}
      </div>
      <div className="field">
        <label>Durum</label>
        <span className={`badge ${status}`}>{status}</span>
        {product.ozonProductId && <span className="hint"> · Ozon product_id: {product.ozonProductId}</span>}
        {lastError && <div className="hint" style={{ color: "var(--danger)" }}>{lastError}</div>}
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={tab === t ? "btn-primary" : "btn-secondary"}
            style={{ borderRadius: "8px 8px 0 0", borderBottom: "none" }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Genel" && (
        <div className="field">
          <label>Ürün adı</label>
          {product.name}
          <div className="hint">Kategori/özellik bilgileri şu an düzenlenemiyor — bunlar sadece ürün oluşturulurken belirlenir.</div>
        </div>
      )}

      {tab === "Fiyat" && (
        <>
          <div className="row">
            <div className="field">
              <label>Alış Fiyatı (USD)</label>
              <input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
            </div>
            <div className="field">
              <label>Satış Fiyatı (otomatik, geçici formül: alış × {TEMP_MARKUP})</label>
              <input type="text" value={computeSalePrice(costPrice) || product.price} disabled />
            </div>
          </div>
          <button className="btn-primary" disabled={saving || !costPrice} onClick={savePrice}>
            Fiyatı Kaydet
          </button>
        </>
      )}

      {tab === "Görseller" && (
        <>
          <div className="field">
            <ImageDropzone images={images} onChange={setImages} />
          </div>
          <button className="btn-primary" disabled={saving || images.length === 0} onClick={saveImages}>
            Görselleri Kaydet
          </button>
        </>
      )}

      {message && (
        <div className={`status-banner ${message.type === "success" ? "imported" : "failed"}`} style={{ marginTop: 16 }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
