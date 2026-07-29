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

export function ProductEditForm({ product }: { product: ProductData }) {
  const [costPrice, setCostPrice] = useState(product.costPrice ?? "");
  const [images, setImages] = useState<string[]>(Array.isArray(product.images) ? (product.images as string[]) : []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function save(partial: { costPrice?: string; images?: string[] }) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/products/${product.offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Güncelleme başarısız" });
        return;
      }
      setMessage({ type: "success", text: "Kaydedildi ve Ozon'a gönderildi." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Bilinmeyen hata" });
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
        <span className={`badge ${product.status}`}>{product.status}</span>
        {product.ozonProductId && <span className="hint"> · Ozon product_id: {product.ozonProductId}</span>}
        {product.lastError && <div className="hint" style={{ color: "var(--danger)" }}>{product.lastError}</div>}
      </div>

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
      <button className="btn-primary" disabled={saving || !costPrice} onClick={() => save({ costPrice })}>
        Fiyatı Kaydet
      </button>

      <div className="field" style={{ marginTop: 24 }}>
        <label>Görseller</label>
        <ImageDropzone images={images} onChange={setImages} />
      </div>
      <button className="btn-primary" disabled={saving || images.length === 0} onClick={() => save({ images })}>
        Görselleri Kaydet
      </button>

      {message && <div className={`status-banner ${message.type === "success" ? "imported" : "failed"}`} style={{ marginTop: 16 }}>{message.text}</div>}
    </div>
  );
}
