"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ImageReplaceGrid } from "../ImageReplaceGrid";
import {
  CategoryPicker,
  AttributeField,
  useRequiredAttributes,
  type CategoryOption,
} from "../../products/new/CategoryAttributeForm";
import { suggestAttributeValue } from "@/import/attribute-mapping";
import { computeSalePrice } from "@/pricing/formula";

const MODEL_NAME_ATTRIBUTE_ID = 9048;

interface Variant {
  id: string;
  offerId: string;
  name: string;
  price: string;
  costPrice: string | null;
  weightGrams: number | null;
  images: unknown;
  originalImages: unknown;
  shopifyMetafields: unknown;
  nameRu: string | null;
  descriptionRu: string | null;
  status: string;
  modelGroup: { id: string; name: string | null; products: { offerId: string }[] } | null;
}

interface SearchResult {
  offerId: string;
  name: string;
  shopifyHandle: string | null;
  shopifyVendor: string | null;
  images: unknown;
  originalImages: unknown;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

export function HandleEditor({ handle }: { handle: string }) {
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [savingImages, setSavingImages] = useState(false);

  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const [category, setCategory] = useState<CategoryOption | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitResults, setSubmitResults] = useState<{ offerId: string; taskId?: string; error?: string }[] | null>(
    null,
  );

  const load = useCallback(async () => {
    const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}`);
    const data = await res.json();
    setVariants(data.variants ?? []);
    setImages(asStringArray(data.variants?.[0]?.images));
  }, [handle]);

  useEffect(() => {
    load();
  }, [load]);

  const metafields = (variants?.[0]?.shopifyMetafields as Record<string, string> | null) ?? null;

  const { requiredAttributes, attributesLoading, attributeAnswers, setAttributeAnswers } = useRequiredAttributes(
    category,
    (attr) => {
      const suggested = suggestAttributeValue(attr.name, metafields);
      return suggested ? { value: suggested, displayValue: suggested } : undefined;
    },
    true,
  );

  const mandatoryAttributes = requiredAttributes.filter(
    (attr) => attr.is_required && attr.id !== MODEL_NAME_ATTRIBUTE_ID,
  );
  const optionalAttributes = requiredAttributes.filter(
    (attr) => !attr.is_required && attr.id !== MODEL_NAME_ATTRIBUTE_ID,
  );

  const modelGroup = variants?.find((v) => v.modelGroup)?.modelGroup ?? null;

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/import/products/search?q=${encodeURIComponent(query)}&excludeHandle=${encodeURIComponent(handle)}`)
        .then((r) => r.json())
        .then((data) => setSearchResults(data.results ?? []));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, handle]);

  async function saveImages() {
    setSavingImages(true);
    try {
      await fetch(`/api/import/products/${encodeURIComponent(handle)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      await load();
    } finally {
      setSavingImages(false);
    }
  }

  async function updateVariantField(offerId: string, field: "weightGrams" | "costPrice", value: string) {
    setVariants((prev) =>
      prev
        ? prev.map((v) =>
            v.offerId === offerId
              ? { ...v, [field]: field === "weightGrams" ? Number(value) || null : value }
              : v,
          )
        : prev,
    );
    await fetch(`/api/import/variant/${encodeURIComponent(offerId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: field === "weightGrams" ? Number(value) || 0 : value }),
    });
  }

  async function linkModel(targetOfferId: string) {
    await fetch(`/api/import/products/${encodeURIComponent(handle)}/link-model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetOfferId }),
    });
    setQuery("");
    setSearchResults([]);
    await load();
  }

  async function translate() {
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}/translate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTranslateError(data.error ?? "Çeviri başarısız");
        return;
      }
      await load();
    } finally {
      setTranslating(false);
    }
  }

  async function unlinkModel() {
    await fetch(`/api/import/products/${encodeURIComponent(handle)}/link-model`, { method: "DELETE" });
    await load();
  }

  async function submit() {
    if (!category) return;
    setSubmitting(true);
    setSubmitResults(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descriptionCategoryId: category.descriptionCategoryId,
          typeId: category.typeId,
          // Sadece zorunlu değil, kullanıcının doldurduğu opsiyonel (içerik puanını artıran)
          // attribute'lar da gönderilir — cevaplanmamış opsiyonel alanlar atlanır.
          attributes: [...mandatoryAttributes, ...optionalAttributes]
            .filter((attr) => attributeAnswers[attr.id]?.value || attributeAnswers[attr.id]?.dictionaryValueId)
            .map((attr) => ({
              id: attr.id,
              value: attributeAnswers[attr.id]?.value,
              dictionaryValueId: attributeAnswers[attr.id]?.dictionaryValueId,
            })),
        }),
      });
      const data = await res.json();
      setSubmitResults(data.results ?? []);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = useMemo(() => {
    if (!category) return false;
    return mandatoryAttributes.every(
      (attr) => Boolean(attributeAnswers[attr.id]?.value || attributeAnswers[attr.id]?.dictionaryValueId),
    );
  }, [category, mandatoryAttributes, attributeAnswers]);

  if (!variants) {
    return (
      <div className="page">
        <div className="card">Yükleniyor...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1>{variants[0]?.name ?? handle}</h1>
        <Link href="/import">
          <button className="btn-secondary">← Listeye dön</button>
        </Link>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Görseller</label>
        <ImageReplaceGrid
          originalImages={asStringArray(variants[0]?.originalImages)}
          images={images}
          onChange={setImages}
        />
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={savingImages} onClick={saveImages}>
          {savingImages ? "Kaydediliyor..." : "Görselleri Kaydet"}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label style={{ margin: 0 }}>Rusça Çeviri</label>
          <button type="button" className="btn-secondary" disabled={translating} onClick={translate}>
            {translating ? "Çevriliyor..." : "Rusça'ya Çevir"}
          </button>
        </div>
        {translateError && <div className="hint" style={{ color: "var(--danger)" }}>{translateError}</div>}
        {variants[0]?.nameRu && (
          <>
            <div className="field">
              <label>Başlık (RU)</label>
              <input type="text" defaultValue={variants[0].nameRu} />
            </div>
            <div className="field">
              <label>Açıklama (RU)</label>
              <textarea rows={6} defaultValue={variants[0].descriptionRu ?? ""} />
            </div>
            <div className="hint">
              Ozon'un ürün açıklaması genellikle kategoriye özel bir attribute (örn. "Аннотация") üzerinden gönderiliyor
              — aşağıdaki attribute formunda o alana bu metni yapıştırabilirsiniz.
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Varyantlar ({variants.length})</label>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Ad</th>
              <th>Ağırlık (g)</th>
              <th>Alış Fiyatı (USD)</th>
              <th>Satış Fiyatı</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id}>
                <td>{v.offerId}</td>
                <td>{v.name}</td>
                <td>
                  <input
                    type="number"
                    style={{ width: 90 }}
                    defaultValue={v.weightGrams ?? ""}
                    onBlur={(e) => updateVariantField(v.offerId, "weightGrams", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    style={{ width: 90 }}
                    defaultValue={v.costPrice ?? ""}
                    onBlur={(e) => updateVariantField(v.offerId, "costPrice", e.target.value)}
                  />
                </td>
                <td>{computeSalePrice(v.costPrice ?? "0", v.weightGrams) || v.price}</td>
                <td>
                  <span className={`badge ${v.status}`}>{v.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Modele Bağla</label>
        <div className="hint">
          Farklı bir Shopify ürününü (örn. aynı ürünün farklı bir aroması) burada arayıp seçerseniz, ikisi Ozon'da tek
          kartta (aynı model) gösterilir.
        </div>
        {modelGroup ? (
          <div className="selected-pill" style={{ marginTop: 8 }}>
            <strong>Grup: {modelGroup.name}</strong> ({modelGroup.products.length} üye)
            <button className="btn-secondary" onClick={unlinkModel} type="button">
              Gruptan Çıkar
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              placeholder="Ürün adı veya SKU ara..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ marginTop: 8 }}
            />
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((r) => {
                  const thumb = asStringArray(r.images)[0] ?? asStringArray(r.originalImages)[0] ?? null;
                  return (
                    <div
                      key={r.offerId}
                      className="search-result-item"
                      style={{ display: "flex", gap: 10, alignItems: "center" }}
                      onClick={() => linkModel(r.offerId)}
                    >
                      {thumb ? (
                        <img src={thumb} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 6, background: "#1a1e24", flexShrink: 0 }} />
                      )}
                      <div>
                        <strong>{r.name}</strong>
                        <div className="hint" style={{ margin: 0 }}>
                          {r.offerId} · {r.shopifyHandle}
                          {r.shopifyVendor ? ` · ${r.shopifyVendor}` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <label>Ozon'a Gönder</label>
        <CategoryPicker selected={category} onSelect={setCategory} />
        {attributesLoading && <div className="hint">Kategori özellikleri yükleniyor...</div>}
        {category && mandatoryAttributes.length > 0 && (
          <>
            <div className="hint" style={{ marginTop: 8 }}>Zorunlu özellikler</div>
            {mandatoryAttributes.map((attr) => (
              <AttributeField
                key={attr.id}
                attr={attr}
                category={category}
                answer={attributeAnswers[attr.id]}
                onChange={(answer) => setAttributeAnswers((prev) => ({ ...prev, [attr.id]: answer }))}
              />
            ))}
          </>
        )}
        {category && optionalAttributes.length > 0 && (
          <>
            <div className="hint" style={{ marginTop: 20 }}>
              Opsiyonel özellikler — doldurmak zorunlu değil, ama Ozon'un içerik puanını/görünürlüğü artırır (ör.
              Annotation, Composition, PDF, JSON rich content).
            </div>
            {optionalAttributes.map((attr) => (
              <AttributeField
                key={attr.id}
                attr={attr}
                category={category}
                answer={attributeAnswers[attr.id]}
                onChange={(answer) => setAttributeAnswers((prev) => ({ ...prev, [attr.id]: answer }))}
              />
            ))}
          </>
        )}

        <button className="btn-primary" disabled={!canSubmit || submitting} onClick={submit} style={{ marginTop: 12 }}>
          {submitting ? "Gönderiliyor..." : "Ozon'a Gönder"}
        </button>

        {submitResults && (
          <div style={{ marginTop: 16 }}>
            {submitResults.map((r) => (
              <div key={r.offerId} className={`status-banner ${r.error ? "failed" : "pending"}`}>
                <strong>{r.offerId}</strong> — {r.error ? `Hata: ${r.error}` : "Gönderildi, Ozon işliyor..."}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
