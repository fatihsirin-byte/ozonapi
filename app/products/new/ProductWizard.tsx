"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ImageDropzone } from "./ImageDropzone";
import { computeSalePrice } from "@/pricing/formula";

interface CategoryOption {
  descriptionCategoryId: number;
  typeId: number;
  path: string;
  typeName: string;
}

interface RequiredAttribute {
  id: number;
  name: string;
  type: string;
  dictionary_id: number;
}

interface AttributeAnswer {
  value?: string;
  dictionaryValueId?: number;
  displayValue?: string;
}

interface Variant {
  key: string;
  label: string;
  costPrice: string;
  weightGrams: string;
  widthCm: string;
  heightCm: string;
  depthCm: string;
  images: string[];
}

interface VariantResult {
  offerId: string;
  status: "pending" | "imported" | "failed";
  ozonProductId: string | null;
  error: string | null;
}

interface CloneData {
  name: string;
  images: string[];
  weightGrams: number;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  category: CategoryOption;
  attributes: Array<{ id: number; dictionaryValueId?: number; value?: string }>;
}

const STEPS = ["Temel Bilgiler", "Kategori", "Ürün Özellikleri", "Varyantlar", "Özet"];

// Ozon'un varyant gruplama alanı — kullanıcıya göstermeden SKU ile otomatik dolduruyoruz.
const MODEL_NAME_ATTRIBUTE_ID = 9048;

function emptyVariant(): Variant {
  return {
    key: crypto.randomUUID(),
    label: "",
    costPrice: "",
    weightGrams: "100",
    widthCm: "10",
    heightCm: "10",
    depthCm: "10",
    images: [],
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function CategoryPicker({
  selected,
  onSelect,
}: {
  selected: CategoryOption | null;
  onSelect: (category: CategoryOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [results, setResults] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/categories/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setResults(data.results ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  if (selected) {
    return (
      <div className="field">
        <label>Kategori</label>
        <div className="selected-pill">
          <strong>{selected.typeName}</strong>&nbsp;({selected.path})
          <button className="btn-secondary" onClick={() => onSelect(null)} type="button">
            Değiştir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <label>Kategori ara</label>
      <input
        type="text"
        placeholder="örn. kablo, tişört, ayakkabı..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="hint">Ürününüze en yakın Ozon kategorisini yazıp aratın.</div>
      {loading && <div className="hint">Aranıyor...</div>}
      {results.length > 0 && (
        <div className="search-results">
          {results.map((r) => (
            <div
              key={`${r.descriptionCategoryId}-${r.typeId}`}
              className="search-result-item"
              onClick={() => onSelect(r)}
            >
              <strong>{r.typeName}</strong>
              <div className="hint" style={{ margin: 0 }}>
                {r.path}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttributeValuePicker({
  attribute,
  category,
  answer,
  onChange,
}: {
  attribute: RequiredAttribute;
  category: CategoryOption;
  answer: AttributeAnswer | undefined;
  onChange(answer: AttributeAnswer): void;
}) {
  const [query, setQuery] = useState(answer?.displayValue ?? "");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [results, setResults] = useState<Array<{ id: number; value: string }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(
      `/api/attributes/${attribute.id}/values?categoryId=${category.descriptionCategoryId}&typeId=${category.typeId}&q=${encodeURIComponent(debouncedQuery)}`,
    )
      .then((r) => r.json())
      .then((data) => setResults(data.values ?? []));
  }, [debouncedQuery, open, attribute.id, category.descriptionCategoryId, category.typeId]);

  return (
    <div className="field">
      <label>{attribute.name}</label>
      <input
        type="text"
        value={query}
        placeholder="Ara ve seç..."
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((v) => (
            <div
              key={v.id}
              className="search-result-item"
              onClick={() => {
                onChange({ dictionaryValueId: v.id, displayValue: v.value });
                setQuery(v.value);
                setOpen(false);
              }}
            >
              {v.value}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VariantCard({
  variant,
  index,
  removable,
  onChange,
  onRemove,
}: {
  variant: Variant;
  index: number;
  removable: boolean;
  onChange(variant: Variant): void;
  onRemove(): void;
}) {
  return (
    <div className="card" style={{ marginBottom: 16, background: "#0f1216" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <strong>Varyant {index + 1}</strong>
        {removable && (
          <button type="button" className="btn-secondary" onClick={onRemove}>
            Kaldır
          </button>
        )}
      </div>
      <div className="field">
        <label>Varyant etiketi (opsiyonel — örn. "Kırmızı - M")</label>
        <input type="text" value={variant.label} onChange={(e) => onChange({ ...variant, label: e.target.value })} />
      </div>
      <div className="row">
        <div className="field">
          <label>Alış Fiyatı (USD)</label>
          <input
            type="number"
            value={variant.costPrice}
            onChange={(e) => onChange({ ...variant, costPrice: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Satış Fiyatı (otomatik hesaplanır: alış + %40 marj + kargo + komisyon/kesintiler, gerekirse gümrük yuvarlaması)</label>
          <input type="text" value={computeSalePrice(variant.costPrice, Number(variant.weightGrams), { widthCm: Number(variant.widthCm), heightCm: Number(variant.heightCm), depthCm: Number(variant.depthCm) }) || "-"} disabled />
        </div>
      </div>
      <div className="row-3">
        <div className="field">
          <label>Ağırlık (gram)</label>
          <input
            type="number"
            value={variant.weightGrams}
            onChange={(e) => onChange({ ...variant, weightGrams: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Genişlik (cm)</label>
          <input
            type="number"
            value={variant.widthCm}
            onChange={(e) => onChange({ ...variant, widthCm: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Yükseklik (cm)</label>
          <input
            type="number"
            value={variant.heightCm}
            onChange={(e) => onChange({ ...variant, heightCm: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label>Derinlik (cm)</label>
        <input
          type="number"
          value={variant.depthCm}
          onChange={(e) => onChange({ ...variant, depthCm: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Görseller</label>
        <ImageDropzone images={variant.images} onChange={(images) => onChange({ ...variant, images })} />
      </div>
    </div>
  );
}

export function ProductWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cloneFrom = searchParams.get("cloneFrom");
  const [step, setStep] = useState(0);

  const [offerId, setOfferId] = useState("");
  const [name, setName] = useState("");

  const [category, setCategory] = useState<CategoryOption | null>(null);
  const [cloneData, setCloneData] = useState<CloneData | null>(null);
  const [cloneLoading, setCloneLoading] = useState(Boolean(cloneFrom));

  const [requiredAttributes, setRequiredAttributes] = useState<RequiredAttribute[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributeAnswers, setAttributeAnswers] = useState<Record<number, AttributeAnswer>>({});

  const [variants, setVariants] = useState<Variant[]>([emptyVariant()]);

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<VariantResult[] | null>(null);

  useEffect(() => {
    if (!cloneFrom) return;
    fetch(`/api/products/${cloneFrom}/clone-data`)
      .then((r) => r.json())
      .then((data: CloneData) => {
        setName(`${data.name} (kopya)`);
        setCategory(data.category);
        setCloneData(data);
        setVariants([
          {
            ...emptyVariant(),
            weightGrams: String(data.weightGrams),
            widthCm: String(data.widthCm),
            heightCm: String(data.heightCm),
            depthCm: String(data.depthCm),
            images: data.images,
          },
        ]);
      })
      .finally(() => setCloneLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloneFrom]);

  useEffect(() => {
    if (!category) {
      setRequiredAttributes([]);
      return;
    }
    setAttributesLoading(true);
    fetch(`/api/categories/${category.descriptionCategoryId}/attributes?typeId=${category.typeId}`)
      .then((r) => r.json())
      .then((data: { attributes: RequiredAttribute[] }) => {
        setRequiredAttributes(data.attributes ?? []);
        setAttributeAnswers((prev) => {
          const next = { ...prev };
          if (data.attributes?.some((a) => a.id === MODEL_NAME_ATTRIBUTE_ID)) {
            next[MODEL_NAME_ATTRIBUTE_ID] = { value: offerId };
          }
          for (const cloned of cloneData?.attributes ?? []) {
            next[cloned.id] = {
              dictionaryValueId: cloned.dictionaryValueId,
              value: cloned.value,
              displayValue: cloned.dictionaryValueId ? "(kopyalanan değer — değiştirmek için yazın)" : undefined,
            };
          }
          return next;
        });
      })
      .finally(() => setAttributesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const canGoNext = useMemo(() => {
    if (step === 0) return Boolean(offerId.trim() && name.trim());
    if (step === 1) return !!category;
    if (step === 2)
      return requiredAttributes.every((attr) => Boolean(attributeAnswers[attr.id]?.value || attributeAnswers[attr.id]?.dictionaryValueId));
    if (step === 3)
      return variants.every((v) => v.costPrice && v.weightGrams && v.widthCm && v.heightCm && v.depthCm && v.images.length > 0);
    return true;
  }, [step, offerId, name, category, requiredAttributes, attributeAnswers, variants]);

  function updateVariant(index: number, next: Variant) {
    setVariants((prev) => prev.map((v, i) => (i === index ? next : v)));
  }

  function variantOfferId(index: number): string {
    return variants.length === 1 ? offerId : `${offerId}-${index + 1}`;
  }

  async function pollVariant(offerIdForVariant: string, index: number) {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/products/${offerIdForVariant}/status`);
      const data = await res.json();
      if (data.status !== "pending") {
        clearInterval(interval);
        setResults((prev) =>
          prev
            ? prev.map((r, i) => (i === index ? { ...r, status: data.status, ozonProductId: data.ozonProductId, error: data.error } : r))
            : prev,
        );
      }
    }, 3000);
  }

  async function handleSubmit() {
    if (!category) return;
    setSubmitting(true);

    const initialResults: VariantResult[] = variants.map((_, i) => ({
      offerId: variantOfferId(i),
      status: "pending",
      ozonProductId: null,
      error: null,
    }));
    setResults(initialResults);

    for (let i = 0; i < variants.length; i += 1) {
      const variant = variants[i];
      const variantName = variant.label ? `${name} - ${variant.label}` : name;
      try {
        const res = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offerId: variantOfferId(i),
            name: variantName,
            costPrice: variant.costPrice,
            images: variant.images,
            descriptionCategoryId: category.descriptionCategoryId,
            typeId: category.typeId,
            weightGrams: Number(variant.weightGrams),
            widthCm: Number(variant.widthCm),
            heightCm: Number(variant.heightCm),
            depthCm: Number(variant.depthCm),
            attributes: requiredAttributes.map((attr) => ({
              id: attr.id,
              value: attr.id === MODEL_NAME_ATTRIBUTE_ID ? offerId : attributeAnswers[attr.id]?.value,
              dictionaryValueId: attributeAnswers[attr.id]?.dictionaryValueId,
            })),
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setResults((prev) =>
            prev ? prev.map((r, idx) => (idx === i ? { ...r, status: "failed", error: data.error ?? "Bilinmeyen hata" } : r)) : prev,
          );
          continue;
        }

        pollVariant(variantOfferId(i), i);
      } catch (err) {
        setResults((prev) =>
          prev
            ? prev.map((r, idx) => (idx === i ? { ...r, status: "failed", error: err instanceof Error ? err.message : "Bilinmeyen hata" } : r))
            : prev,
        );
      }
    }

    setSubmitting(false);
  }

  if (results) {
    return (
      <div className="card">
        {results.map((r) => (
          <div key={r.offerId} className={`status-banner ${r.status}`}>
            <strong>{r.offerId}</strong> —{" "}
            {r.status === "pending" && "Ozon'a gönderiliyor, işleniyor... (birkaç dakika sürebilir)"}
            {r.status === "imported" && `Başarıyla oluşturuldu! product_id: ${r.ozonProductId}`}
            {r.status === "failed" && `Hata: ${r.error ?? "Bilinmeyen hata"}`}
          </div>
        ))}
        {results.every((r) => r.status !== "pending") && (
          <button className="btn-primary" onClick={() => router.push("/products")}>
            Ürün listesine dön
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      {cloneFrom && (
        <div className="status-banner pending">
          {cloneLoading ? `${cloneFrom} kopyalanıyor...` : `${cloneFrom} ürününden kopyalandı — SKU, isim ve fiyatı değiştirmeyi unutmayın.`}
        </div>
      )}
      <div className="stepper">
        {STEPS.map((label, i) => (
          <div key={label} className={`step-dot ${i === step ? "active" : i < step ? "done" : ""}`} title={label} />
        ))}
      </div>

      {step === 0 && (
        <>
          <div className="field">
            <label>SKU (offer_id) — birden fazla varyant varsa bu ortak ön ek olacak</label>
            <input type="text" value={offerId} onChange={(e) => setOfferId(e.target.value)} placeholder="örn. URUN-001" />
          </div>
          <div className="field">
            <label>Ürün adı (genel)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </>
      )}

      {step === 1 && <CategoryPicker selected={category} onSelect={setCategory} />}

      {step === 2 && (
        <>
          {attributesLoading && <div className="hint">Kategori özellikleri yükleniyor...</div>}
          {!attributesLoading && requiredAttributes.length === 0 && (
            <div className="hint">Bu kategori için zorunlu ek özellik yok.</div>
          )}
          {category &&
            requiredAttributes
              .filter((attr) => attr.id !== MODEL_NAME_ATTRIBUTE_ID)
              .map((attr) =>
                attr.dictionary_id > 0 ? (
                  <AttributeValuePicker
                    key={attr.id}
                    attribute={attr}
                    category={category}
                    answer={attributeAnswers[attr.id]}
                    onChange={(answer) => setAttributeAnswers((prev) => ({ ...prev, [attr.id]: answer }))}
                  />
                ) : (
                  <div className="field" key={attr.id}>
                    <label>{attr.name}</label>
                    <input
                      type="text"
                      value={attributeAnswers[attr.id]?.value ?? ""}
                      onChange={(e) => setAttributeAnswers((prev) => ({ ...prev, [attr.id]: { value: e.target.value } }))}
                    />
                  </div>
                ),
              )}
        </>
      )}

      {step === 3 && (
        <>
          <div className="hint" style={{ marginBottom: 16 }}>
            Ürünün renk/ağırlık gibi farklı seçenekleri varsa her biri için bir varyant ekleyin — hepsi Ozon'da aynı ürün
            kartında gruplanır.
          </div>
          {variants.map((variant, i) => (
            <VariantCard
              key={variant.key}
              variant={variant}
              index={i}
              removable={variants.length > 1}
              onChange={(next) => updateVariant(i, next)}
              onRemove={() => setVariants((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}
          <button type="button" className="btn-secondary" onClick={() => setVariants((prev) => [...prev, emptyVariant()])}>
            + Varyant Ekle
          </button>
        </>
      )}

      {step === 4 && (
        <div>
          <div className="field">
            <label>SKU / Ürün adı</label>
            {offerId} — {name}
          </div>
          <div className="field">
            <label>Kategori</label>
            {category?.path}
          </div>
          <div className="field">
            <label>Varyantlar ({variants.length})</label>
            {variants.map((v, i) => (
              <div key={v.key} className="hint">
                {variantOfferId(i)}
                {v.label ? ` (${v.label})` : ""}: alış {v.costPrice} USD → satış {computeSalePrice(v.costPrice, Number(v.weightGrams), { widthCm: Number(v.widthCm), heightCm: Number(v.heightCm), depthCm: Number(v.depthCm) })} USD ·{" "}
                {v.weightGrams}g · {v.widthCm}×{v.heightCm}×{v.depthCm}cm · {v.images.length} görsel
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="actions">
        <button className="btn-secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Geri
        </button>
        {step < STEPS.length - 1 ? (
          <button className="btn-primary" disabled={!canGoNext} onClick={() => setStep((s) => s + 1)}>
            İleri
          </button>
        ) : (
          <button className="btn-primary" disabled={submitting} onClick={handleSubmit}>
            {submitting ? "Gönderiliyor..." : "Ozon'a Gönder"}
          </button>
        )}
      </div>
    </div>
  );
}
