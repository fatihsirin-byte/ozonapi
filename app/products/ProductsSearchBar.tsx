"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// SKU (offerId), ürün adı ve Rusça adda arar — bkz. src/modules/products/products.service.ts
// listAllProducts (2026-09-11, kullanıcı talebi).
export function ProductsSearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");

  function submit() {
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) {
      params.set("q", value.trim());
    } else {
      params.delete("q");
    }
    params.delete("page");
    router.push(`/products?${params.toString()}`);
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="SKU veya ürün adı ara..."
        style={{ minWidth: 320 }}
      />
      <button className="btn-secondary" onClick={submit}>Ara</button>
      {searchParams.get("q") && (
        <button
          className="btn-secondary"
          onClick={() => {
            setValue("");
            const params = new URLSearchParams(searchParams.toString());
            params.delete("q");
            params.delete("page");
            router.push(`/products?${params.toString()}`);
          }}
        >
          Temizle
        </button>
      )}
    </div>
  );
}
