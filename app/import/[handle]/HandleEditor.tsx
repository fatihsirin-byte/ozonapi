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
import { PriceCalculatorModal } from "../../products/[offerId]/PriceCalculatorModal";

const MODEL_NAME_ATTRIBUTE_ID = 9048;

interface Variant {
  id: string;
  offerId: string;
  name: string;
  price: string;
  costPrice: string | null;
  weightGrams: number | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  images: unknown;
  originalImages: unknown;
  shopifyMetafields: unknown;
  shopifyVendor: string | null;
  shopifyType: string | null;
  nameRu: string | null;
  descriptionRu: string | null;
  status: string;
  excludedFromSubmit: boolean;
  ozonProductId: string | null;
  importTaskId: string | null;
  modelGroup: { id: string; name: string | null; products: { offerId: string }[] } | null;
}

interface CloneAttribute {
  id: number;
  dictionaryValueId?: number;
  value?: string;
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

  const [sloganProductName, setSloganProductName] = useState("");
  const [sloganLoading, setSloganLoading] = useState(false);
  const [sloganError, setSloganError] = useState<string | null>(null);
  const [slogan, setSlogan] = useState<{ title: string; slogan1: string; slogan2: string } | null>(null);
  const [copiedSloganField, setCopiedSloganField] = useState<string | null>(null);

  const [category, setCategory] = useState<CategoryOption | null>(null);
  const [cloneAttributes, setCloneAttributes] = useState<CloneAttribute[] | null>(null);
  const [specLoaded, setSpecLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitResults, setSubmitResults] = useState<
    { offerId: string; status: "pending" | "imported" | "failed"; ozonProductId?: string | null; error?: string }[] | null
  >(null);
  const [imageSaveError, setImageSaveError] = useState<string | null>(null);
  const [priceCalcOfferId, setPriceCalcOfferId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}`);
    const data = await res.json();
    const loadedVariants: Variant[] = data.variants ?? [];
    setVariants(loadedVariants);
    setImages(asStringArray(loadedVariants?.[0]?.images));
    setSloganProductName((prev) => prev || loadedVariants?.[0]?.name || "");
    return loadedVariants;
  }, [handle]);

  useEffect(() => {
    load();
  }, [load]);

  // Ürün zaten Ozon'a gönderilmişse, daha önce seçilmiş kategori/attribute'ları geri yükle —
  // aksi halde her sayfa açılışında kategori/özellikler sıfırdan seçilmek zorunda kalınıyordu.
  useEffect(() => {
    if (!variants || specLoaded) return;
    const submittedOfferId = variants.find((v) => v.ozonProductId)?.offerId;
    if (!submittedOfferId) return;
    setSpecLoaded(true);
    fetch(`/api/products/${encodeURIComponent(submittedOfferId)}/clone-data`)
      .then((r) => r.json())
      .then((data) => {
        if (data.category) setCategory(data.category);
        if (data.attributes) setCloneAttributes(data.attributes);
      })
      .catch(() => {});
  }, [variants, specLoaded]);

  // "pending" durumda kalmış (daha önce gönderilmiş ama sonucu hiç kontrol edilmemiş)
  // varyantların gerçek Ozon durumunu sayfa açılışında otomatik sorgula.
  useEffect(() => {
    if (!variants) return;
    const pendingWithTask = variants.filter((v) => v.status === "pending" && v.importTaskId);
    for (const v of pendingWithTask) {
      fetch(`/api/products/${encodeURIComponent(v.offerId)}/status`)
        .then((r) => r.json())
        .then((data) => {
          if (data.status !== "pending") {
            setVariants((prev) =>
              prev ? prev.map((p) => (p.offerId === v.offerId ? { ...p, status: data.status } : p)) : prev,
            );
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants?.map((v) => v.offerId).join(",")]);

  const metafields = (variants?.[0]?.shopifyMetafields as Record<string, string> | null) ?? null;
  const vendor = variants?.[0]?.shopifyVendor ?? null;

  const { requiredAttributes, attributesLoading, attributeAnswers, setAttributeAnswers } = useRequiredAttributes(
    category,
    (attr) => {
      // Daha önce Ozon'a gönderilmişse, o zaman seçilmiş gerçek değeri her şeyden önce kullan.
      const cloned = cloneAttributes?.find((a) => a.id === attr.id);
      if (cloned) {
        return {
          dictionaryValueId: cloned.dictionaryValueId,
          value: cloned.value,
          displayValue: cloned.dictionaryValueId ? "(mevcut değer — değiştirmek için yazın)" : undefined,
        };
      }
      const suggested = suggestAttributeValue(attr.name, metafields, vendor);
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
    setImageSaveError(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();
      if (data.errors?.length) {
        setImageSaveError(
          data.errors.map((e: { offerId: string; error: string }) => `${e.offerId}: ${e.error}`).join("; "),
        );
      }
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

  async function toggleVariantExcluded(offerId: string, excluded: boolean) {
    setVariants((prev) =>
      prev ? prev.map((v) => (v.offerId === offerId ? { ...v, excludedFromSubmit: excluded } : v)) : prev,
    );
    await fetch(`/api/import/variant/${encodeURIComponent(offerId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excludedFromSubmit: excluded }),
    });
  }

  async function deleteVariant(offerId: string) {
    if (!confirm(`${offerId} varyantını kalıcı olarak silmek istediğinize emin misiniz?`)) return;
    await fetch(`/api/import/variant/${encodeURIComponent(offerId)}`, { method: "DELETE" });
    setVariants((prev) => (prev ? prev.filter((v) => v.offerId !== offerId) : prev));
  }

  async function applyPriceOverride(offerId: string, costPrice: string, priceUsd: string) {
    await fetch(`/api/products/${encodeURIComponent(offerId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ costPrice, priceOverride: priceUsd }),
    });
    setPriceCalcOfferId(null);
    await load();
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

  async function generateSlogan() {
    setSloganLoading(true);
    setSloganError(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}/slogan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: sloganProductName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSloganError(data.error ?? "Slogan oluşturulamadı");
        return;
      }
      setSlogan(data);
    } finally {
      setSloganLoading(false);
    }
  }

  async function copySloganField(field: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedSloganField(field);
    setTimeout(() => setCopiedSloganField((current) => (current === field ? null : current)), 1500);
  }

  async function unlinkModel() {
    await fetch(`/api/import/products/${encodeURIComponent(handle)}/link-model`, { method: "DELETE" });
    await load();
  }

  function pollSubmittedVariant(offerId: string) {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/products/${encodeURIComponent(offerId)}/status`);
      const data = await res.json();
      if (data.status !== "pending") {
        clearInterval(interval);
        setSubmitResults((prev) =>
          prev
            ? prev.map((r) =>
                r.offerId === offerId
                  ? { ...r, status: data.status, ozonProductId: data.ozonProductId, error: data.error }
                  : r,
              )
            : prev,
        );
        load();
      }
    }, 3000);
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
      const results = (data.results ?? []) as { offerId: string; taskId?: string; error?: string }[];
      setSubmitResults(
        results.map((r) => ({
          offerId: r.offerId,
          status: r.error ? ("failed" as const) : ("pending" as const),
          error: r.error,
        })),
      );
      for (const r of results) {
        if (!r.error) pollSubmittedVariant(r.offerId);
      }
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
      <div className="page-wide">
        <div className="card">Yükleniyor...</div>
      </div>
    );
  }

  return (
    <div className="page-wide">
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
        {variants.some((v) => v.ozonProductId) && (
          <div className="hint" style={{ marginTop: 8 }}>
            Bu ürün zaten Ozon'a gönderilmiş — kaydedince görseller Ozon'a da yeniden gönderilir.
          </div>
        )}
        {imageSaveError && <div className="hint" style={{ color: "var(--danger)", marginTop: 8 }}>{imageSaveError}</div>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Canva Slogan Oluştur</label>
        <div className="hint" style={{ marginBottom: 8 }}>
          İnfografik görsel için Rusça ana başlık + 2 kısa slogan üretir (Canva'da kullanmak üzere kopyalayın).
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={sloganProductName}
            onChange={(e) => setSloganProductName(e.target.value)}
            placeholder="Ürün adı"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn-primary" disabled={sloganLoading || !sloganProductName.trim()} onClick={generateSlogan}>
            {sloganLoading ? "Oluşturuluyor..." : "Slogan Oluştur"}
          </button>
        </div>
        {sloganError && <div className="hint" style={{ color: "var(--danger)" }}>{sloganError}</div>}
        {slogan && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {(
              [
                ["title", "Başlık", slogan.title],
                ["slogan1", "Slogan 1", slogan.slogan1],
                ["slogan2", "Slogan 2", slogan.slogan2],
              ] as const
            ).map(([field, label, value]) => (
              <div
                key={field}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: "#0f1216",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                <div>
                  <div className="hint" style={{ margin: 0 }}>{label}</div>
                  <strong>{value}</strong>
                </div>
                <button type="button" className="btn-secondary" onClick={() => copySloganField(field, value)}>
                  {copiedSloganField === field ? "Kopyalandı ✓" : "Kopyala"}
                </button>
              </div>
            ))}
          </div>
        )}
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
        <div className="hint" style={{ marginBottom: 8 }}>
          "Pasifleştir" bir varyantı silmeden Ozon'a göndermeyi atlar (geri aktifleştirilebilir). "Sil" kalıcıdır.
          Ürün zaten gönderilmişse, ağırlık/alış fiyatı değiştirince yeni satış fiyatı otomatik Ozon'a gider —
          ağırlığın kendisi Ozon'da değişmez, o "Görselleri Kaydet" gibi tam bir yeniden gönderim gerektirir.
        </div>
        <table style={{ tableLayout: "fixed", wordBreak: "break-word" }}>
          <colgroup>
            <col style={{ width: "14%" }} />
            <col style={{ width: "28%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "17%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Ad</th>
              <th>Ağırlık (g)</th>
              <th>Alış Fiyatı (USD)</th>
              <th>Satış Fiyatı</th>
              <th>Durum</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} style={v.excludedFromSubmit ? { opacity: 0.5 } : undefined}>
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
                <td>
                  {v.price || computeSalePrice(v.costPrice ?? "0", v.weightGrams)}
                  {v.ozonProductId && (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ marginLeft: 6, fontSize: 11, padding: "2px 6px" }}
                      onClick={() => setPriceCalcOfferId(v.offerId)}
                    >
                      Düzenle
                    </button>
                  )}
                </td>
                <td>
                  {v.excludedFromSubmit ? (
                    <span className="badge failed">pasif</span>
                  ) : (
                    <span className={`badge ${v.status}`}>{v.status}</span>
                  )}
                </td>
                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => toggleVariantExcluded(v.offerId, !v.excludedFromSubmit)}
                  >
                    {v.excludedFromSubmit ? "Aktifleştir" : "Pasifleştir"}
                  </button>
                  {v.status === "draft" && (
                    <button type="button" className="btn-secondary" onClick={() => deleteVariant(v.offerId)}>
                      Sil
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {priceCalcOfferId &&
        (() => {
          const v = variants.find((variant) => variant.offerId === priceCalcOfferId);
          if (!v) return null;
          return (
            <PriceCalculatorModal
              costPrice={v.costPrice ?? ""}
              weightGrams={v.weightGrams}
              widthCm={v.widthCm}
              heightCm={v.heightCm}
              depthCm={v.depthCm}
              currentPrice={v.price}
              onClose={() => setPriceCalcOfferId(null)}
              onApply={(priceUsd) => applyPriceOverride(v.offerId, v.costPrice ?? "0", priceUsd)}
            />
          );
        })()}

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
                        <img
                          src={thumb}
                          alt=""
                          className="zoom-thumb"
                          style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
                        />
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
        <div className="row" style={{ marginBottom: 16 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Vendor (Shopify)</label>
            {variants[0]?.shopifyVendor ?? <span className="hint">—</span>}
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Type (Shopify)</label>
            {variants[0]?.shopifyType ?? <span className="hint">—</span>}
          </div>
        </div>
        <div className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
          Kategori seçerken Type'ı, Marka (Brand) attribute'unu doldururken Vendor'ı referans alabilirsiniz.
        </div>
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
              <div key={r.offerId} className={`status-banner ${r.status}`}>
                <strong>{r.offerId}</strong> —{" "}
                {r.status === "pending" && "Gönderildi, Ozon işliyor... (birkaç dakika sürebilir)"}
                {r.status === "imported" && `Başarıyla oluşturuldu! product_id: ${r.ozonProductId}`}
                {r.status === "failed" && `Hata: ${r.error ?? "Bilinmeyen hata"}`}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
