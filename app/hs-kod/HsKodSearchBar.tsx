"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export interface CategoryOption {
  descriptionCategoryId: number;
  typeId: number;
  label: string;
}

export function HsKodSearchBar({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");

  function categoryParam() {
    const descriptionCategoryId = searchParams.get("cat");
    const typeId = searchParams.get("type");
    return descriptionCategoryId && typeId ? `${descriptionCategoryId}:${typeId}` : "";
  }

  function submit(overrides: { q?: string; category?: string; onlyMissing?: boolean } = {}) {
    const params = new URLSearchParams(searchParams.toString());
    const q = overrides.q ?? value;
    if (q.trim()) {
      params.set("q", q.trim());
    } else {
      params.delete("q");
    }
    const category = overrides.category ?? categoryParam();
    if (category) {
      const [cat, type] = category.split(":");
      params.set("cat", cat);
      params.set("type", type);
    } else {
      params.delete("cat");
      params.delete("type");
    }
    const onlyMissing = overrides.onlyMissing ?? searchParams.get("missing") === "1";
    if (onlyMissing) {
      params.set("missing", "1");
    } else {
      params.delete("missing");
    }
    params.delete("page");
    router.push(`/hs-kod?${params.toString()}`);
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Türkçe/Rusça ürün adı ya da SKU ara..."
        style={{ minWidth: 320 }}
      />
      <select value={categoryParam()} onChange={(e) => submit({ category: e.target.value })} style={{ minWidth: 220 }}>
        <option value="">Tüm kategoriler</option>
        {categories.map((c) => (
          <option key={`${c.descriptionCategoryId}:${c.typeId}`} value={`${c.descriptionCategoryId}:${c.typeId}`}>
            {c.label}
          </option>
        ))}
      </select>
      <button className="btn-secondary" onClick={() => submit()}>
        Ara
      </button>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
        <input
          type="checkbox"
          checked={searchParams.get("missing") === "1"}
          onChange={(e) => submit({ onlyMissing: e.target.checked })}
        />
        Sadece HS kodu olmayanlar
      </label>
      {(searchParams.get("q") || searchParams.get("cat") || searchParams.get("missing")) && (
        <button
          className="btn-secondary"
          onClick={() => {
            setValue("");
            router.push("/hs-kod");
          }}
        >
          Temizle
        </button>
      )}
    </div>
  );
}
