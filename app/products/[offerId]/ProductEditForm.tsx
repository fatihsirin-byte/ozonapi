"use client";

import { useEffect, useState } from "react";
import { ImageDropzone } from "../new/ImageDropzone";
import { CategoryPicker, AttributeField, useRequiredAttributes, type CategoryOption } from "../new/CategoryAttributeForm";
import { computeSalePrice, estimateShippingCostUsd, computeBillingWeightGrams } from "@/pricing/formula";

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
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
}

interface CloneAttribute {
  id: number;
  dictionaryValueId?: number;
  value?: string;
}

const MODEL_NAME_ATTRIBUTE_ID = 9048;
const TABS = ["Genel", "Fiyat", "Görseller", "Kategori & Özellikler"] as const;
type Tab = (typeof TABS)[number];

export function ProductEditForm({ product }: { product: ProductData }) {
  const [tab, setTab] = useState<Tab>("Genel");
  const [costPrice, setCostPrice] = useState(product.costPrice ?? "");
  const [images, setImages] = useState<string[]>(Array.isArray(product.images) ? (product.images as string[]) : []);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(product.status);
  const [lastError, setLastError] = useState(product.lastError);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [category, setCategory] = useState<CategoryOption | null>(null);
  const [cloneAttributes, setCloneAttributes] = useState<CloneAttribute[] | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specLoaded, setSpecLoaded] = useState(false);

  const { requiredAttributes, attributesLoading, attributeAnswers, setAttributeAnswers } = useRequiredAttributes(
    category,
    (attr) => {
      const cloned = cloneAttributes?.find((a) => a.id === attr.id);
      if (!cloned) return undefined;
      return {
        dictionaryValueId: cloned.dictionaryValueId,
        value: cloned.value,
        displayValue: cloned.dictionaryValueId ? "(mevcut değer — değiştirmek için yazın)" : undefined,
      };
    },
    true,
  );

  useEffect(() => {
    if (tab !== "Kategori & Özellikler" || specLoaded) return;
    setSpecLoading(true);
    setSpecLoaded(true);
    fetch(`/api/products/${product.offerId}/clone-data`)
      .then((r) => r.json())
      .then((data) => {
        setCategory(data.category ?? null);
        setCloneAttributes(data.attributes ?? []);
      })
      .finally(() => setSpecLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, specLoaded]);

  async function saveSpec() {
    if (!category) return;
    setSaving(true);
    setMessage(null);
    setStatus("pending");
    try {
      const res = await fetch(`/api/products/${product.offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: { descriptionCategoryId: category.descriptionCategoryId, typeId: category.typeId },
          attributes: requiredAttributes
            .filter((attr) => attr.id !== MODEL_NAME_ATTRIBUTE_ID)
            .filter((attr) => attributeAnswers[attr.id]?.value || attributeAnswers[attr.id]?.dictionaryValueId)
            .map((attr) => ({
              id: attr.id,
              value: attributeAnswers[attr.id]?.value,
              dictionaryValueId: attributeAnswers[attr.id]?.dictionaryValueId,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Güncelleme başarısız" });
        setStatus(product.status);
        return;
      }
      setMessage({ type: "success", text: "Özellikler gönderildi, Ozon işliyor..." });
      pollUntilResolved();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Bilinmeyen hata" });
      setStatus(product.status);
    } finally {
      setSaving(false);
    }
  }

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
        <>
          <div className="field">
            <label>Ürün adı</label>
            {product.name}
          </div>
          <div className="field">
            <label>Ağırlık / Koli Ölçüleri</label>
            {product.weightGrams ? (
              <>
                {product.weightGrams}g · {product.widthCm}×{product.heightCm}×{product.depthCm}cm
                <div className="hint">
                  Kargoda kullanılan ağırlık (+%20 paketleme payı, gerekirse hacimsel):{" "}
                  {Math.round(
                    computeBillingWeightGrams(product.weightGrams, product.widthCm, product.heightCm, product.depthCm),
                  )}
                  g
                </div>
              </>
            ) : (
              <span className="hint">Bilinmiyor</span>
            )}
          </div>
          <div className="hint">Kategori/özellik bilgilerini "Kategori & Özellikler" sekmesinden düzenleyebilirsiniz.</div>
        </>
      )}

      {tab === "Fiyat" && (
        <>
          <div className="row">
            <div className="field">
              <label>Alış Fiyatı (USD)</label>
              <input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
            </div>
            <div className="field">
              <label>Satış Fiyatı (otomatik hesaplanır: alış + %40 marj + kargo + komisyon/kesintiler, gerekirse gümrük yuvarlaması)</label>
              <input
                type="text"
                value={
                  computeSalePrice(costPrice, product.weightGrams, {
                    widthCm: product.widthCm,
                    heightCm: product.heightCm,
                    depthCm: product.depthCm,
                  }) || product.price
                }
                disabled
              />
            </div>
          </div>
          {product.weightGrams && (
            <div className="hint" style={{ marginBottom: 12 }}>
              Kargo maliyeti ASE&GBS tarifesine göre hesaplanıp fiyata dahil edildi (
              {Math.round(
                computeBillingWeightGrams(product.weightGrams, product.widthCm, product.heightCm, product.depthCm),
              )}
              g için ~$
              {estimateShippingCostUsd(
                computeBillingWeightGrams(product.weightGrams, product.widthCm, product.heightCm, product.depthCm),
              ).toFixed(2)}
              ).
            </div>
          )}
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

      {tab === "Kategori & Özellikler" && (
        <>
          {specLoading && <div className="hint">Mevcut kategori/özellikler Ozon'dan çekiliyor...</div>}
          {!specLoading && (
            <>
              <CategoryPicker selected={category} onSelect={setCategory} />
              {attributesLoading && <div className="hint">Kategori özellikleri yükleniyor...</div>}
              {category &&
                requiredAttributes
                  .filter((attr) => attr.id !== MODEL_NAME_ATTRIBUTE_ID)
                  .map((attr) => (
                    <AttributeField
                      key={attr.id}
                      attr={attr}
                      category={category}
                      answer={attributeAnswers[attr.id]}
                      onChange={(answer) => setAttributeAnswers((prev) => ({ ...prev, [attr.id]: answer }))}
                    />
                  ))}
              <button className="btn-primary" disabled={saving || !category} onClick={saveSpec}>
                Özellikleri Kaydet
              </button>
            </>
          )}
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
