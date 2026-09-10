"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Müşteri adı, Ozon sipariş no, ürün SKU'su, ürün adı ve offerId'de arar (2026-09-09, kullanıcı
// talebi) — bkz. src/modules/orders/orders.service.ts (findSearchMatchingOrderIds). Gerçek
// "barkod" (EAN/UPC) verisi sistemde hiç saklanmadığı için o alan kapsam dışı.
export function OrdersSearchBar() {
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
    router.push(`/orders?${params.toString()}`);
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
        placeholder="Müşteri adı, sipariş no, ürün SKU/adı ara..."
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
            router.push(`/orders?${params.toString()}`);
          }}
        >
          Temizle
        </button>
      )}
    </div>
  );
}
