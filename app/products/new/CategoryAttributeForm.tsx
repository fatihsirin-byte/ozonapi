"use client";

import { useEffect, useState } from "react";

export interface CategoryOption {
  descriptionCategoryId: number;
  typeId: number;
  path: string;
  typeName: string;
}

export interface RequiredAttribute {
  id: number;
  name: string;
  type: string;
  dictionary_id: number;
  is_required?: boolean;
  is_aspect?: boolean;
}

export interface AttributeAnswer {
  value?: string;
  dictionaryValueId?: number;
  displayValue?: string;
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function CategoryPicker({
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

export function AttributeValuePicker({
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

/**
 * Bir kategorinin zorunlu attribute'larını, kategori seçilir seçilmez çeker; ayrıca varsa
 * bir "ön doldurma" fonksiyonu (örn. Shopify metafield eşleştirmesi) çağırarak boş cevapları doldurur.
 */
export function useRequiredAttributes(
  category: CategoryOption | null,
  prefill?: (attribute: RequiredAttribute) => AttributeAnswer | undefined,
  includeOptional = false,
) {
  const [requiredAttributes, setRequiredAttributes] = useState<RequiredAttribute[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributeAnswers, setAttributeAnswers] = useState<Record<number, AttributeAnswer>>({});

  useEffect(() => {
    if (!category) {
      setRequiredAttributes([]);
      return;
    }
    setAttributesLoading(true);
    const optionalParam = includeOptional ? "&includeOptional=1" : "";
    fetch(`/api/categories/${category.descriptionCategoryId}/attributes?typeId=${category.typeId}${optionalParam}`)
      .then((r) => r.json())
      .then((data: { attributes: RequiredAttribute[] }) => {
        const attrs = data.attributes ?? [];
        setRequiredAttributes(attrs);
        if (prefill) {
          setAttributeAnswers((prev) => {
            const next = { ...prev };
            for (const attr of attrs) {
              if (next[attr.id]) continue;
              const suggested = prefill(attr);
              if (suggested) next[attr.id] = suggested;
            }
            return next;
          });
        }
      })
      .finally(() => setAttributesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  return { requiredAttributes, attributesLoading, attributeAnswers, setAttributeAnswers };
}
