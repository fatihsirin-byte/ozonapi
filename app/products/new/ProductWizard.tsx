"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

const STEPS = ["Temel Bilgiler", "Kategori", "Ürün Özellikleri", "Boyut & Ağırlık", "Özet"];

// Ozon'un varyant gruplama alanı — kullanıcıya göstermeden SKU ile otomatik dolduruyoruz.
const MODEL_NAME_ATTRIBUTE_ID = 9048;

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

export function ProductWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [offerId, setOfferId] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [imagesText, setImagesText] = useState("");

  const [category, setCategory] = useState<CategoryOption | null>(null);

  const [requiredAttributes, setRequiredAttributes] = useState<RequiredAttribute[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributeAnswers, setAttributeAnswers] = useState<Record<number, AttributeAnswer>>({});

  const [weightGrams, setWeightGrams] = useState("100");
  const [widthCm, setWidthCm] = useState("10");
  const [heightCm, setHeightCm] = useState("10");
  const [depthCm, setDepthCm] = useState("10");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "pending" | "imported" | "failed">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [ozonProductId, setOzonProductId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        if (data.attributes?.some((a) => a.id === MODEL_NAME_ATTRIBUTE_ID)) {
          setAttributeAnswers((prev) => ({ ...prev, [MODEL_NAME_ATTRIBUTE_ID]: { value: offerId } }));
        }
      })
      .finally(() => setAttributesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const images = useMemo(
    () =>
      imagesText
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean),
    [imagesText],
  );

  const canGoNext = useMemo(() => {
    if (step === 0) return offerId.trim() && name.trim() && price.trim() && images.length > 0;
    if (step === 1) return !!category;
    if (step === 2) return requiredAttributes.every((attr) => Boolean(attributeAnswers[attr.id]?.value || attributeAnswers[attr.id]?.dictionaryValueId));
    if (step === 3) return weightGrams && widthCm && heightCm && depthCm;
    return true;
  }, [step, offerId, name, price, images, category, requiredAttributes, attributeAnswers, weightGrams, widthCm, heightCm, depthCm]);

  function startPolling() {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/products/${offerId}/status`);
      const data = await res.json();
      if (data.status !== "pending") {
        setImportStatus(data.status);
        setImportError(data.error);
        setOzonProductId(data.ozonProductId);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 3000);
  }

  async function handleSubmit() {
    if (!category) return;
    setSubmitting(true);
    setSubmitError(null);
    setImportStatus("pending");

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId,
          name,
          price,
          images,
          descriptionCategoryId: category.descriptionCategoryId,
          typeId: category.typeId,
          weightGrams: Number(weightGrams),
          widthCm: Number(widthCm),
          heightCm: Number(heightCm),
          depthCm: Number(depthCm),
          attributes: requiredAttributes.map((attr) => ({
            id: attr.id,
            value: attributeAnswers[attr.id]?.value,
            dictionaryValueId: attributeAnswers[attr.id]?.dictionaryValueId,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSubmitError(data.error ?? "Bilinmeyen hata");
        setImportStatus("failed");
        return;
      }

      startPolling();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Bilinmeyen hata");
      setImportStatus("failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (importStatus !== "idle") {
    return (
      <div className="card">
        {importStatus === "pending" && (
          <div className="status-banner pending">Ozon'a gönderiliyor, işleniyor... (birkaç dakika sürebilir)</div>
        )}
        {importStatus === "imported" && (
          <div className="status-banner imported">
            Ürün başarıyla oluşturuldu! Ozon product_id: {ozonProductId}
          </div>
        )}
        {importStatus === "failed" && (
          <div className="status-banner failed">
            Ürün oluşturulamadı: {importError ?? submitError ?? "Bilinmeyen hata"}
          </div>
        )}
        {importStatus !== "pending" && (
          <button className="btn-primary" onClick={() => router.push("/products")}>
            Ürün listesine dön
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="stepper">
        {STEPS.map((label, i) => (
          <div key={label} className={`step-dot ${i === step ? "active" : i < step ? "done" : ""}`} title={label} />
        ))}
      </div>

      {step === 0 && (
        <>
          <div className="field">
            <label>SKU (offer_id)</label>
            <input type="text" value={offerId} onChange={(e) => setOfferId(e.target.value)} placeholder="örn. URUN-001" />
          </div>
          <div className="field">
            <label>Ürün adı</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Fiyat (USD)</label>
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="field">
            <label>Görsel URL'leri (her satıra bir tane)</label>
            <textarea rows={3} value={imagesText} onChange={(e) => setImagesText(e.target.value)} />
            <div className="hint">Şimdilik sadece herkese açık bir görsel linki gerekiyor.</div>
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
                    onChange={(e) =>
                      setAttributeAnswers((prev) => ({ ...prev, [attr.id]: { value: e.target.value } }))
                    }
                  />
                </div>
              ),
            )}
        </>
      )}

      {step === 3 && (
        <div className="row">
          <div className="field">
            <label>Ağırlık (gram)</label>
            <input type="number" value={weightGrams} onChange={(e) => setWeightGrams(e.target.value)} />
          </div>
          <div className="field">
            <label>Genişlik (cm)</label>
            <input type="number" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} />
          </div>
          <div className="field">
            <label>Yükseklik (cm)</label>
            <input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
          </div>
          <div className="field">
            <label>Derinlik (cm)</label>
            <input type="number" value={depthCm} onChange={(e) => setDepthCm(e.target.value)} />
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <div className="field">
            <label>SKU</label>
            {offerId}
          </div>
          <div className="field">
            <label>Ad</label>
            {name}
          </div>
          <div className="field">
            <label>Fiyat</label>
            {price} USD
          </div>
          <div className="field">
            <label>Kategori</label>
            {category?.path}
          </div>
          <div className="field">
            <label>Boyut/Ağırlık</label>
            {weightGrams}g · {widthCm}×{heightCm}×{depthCm}cm
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
