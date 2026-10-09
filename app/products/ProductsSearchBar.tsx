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

  // Hangi pazaryerine bağlı ürünlerin gösterileceği — "Ozon" / "toptantr" / "İkisine de bağlı"
  // (2026-09-27, kullanıcı talebi). Boş = ikisinden birine bağlı olan her şey (varsayılan).
  function setMarketplace(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("marketplace", value);
    else params.delete("marketplace");
    params.delete("page");
    router.push(`/products?${params.toString()}`);
  }

  function setStock(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("stock", value);
    params.delete("page");
    router.push(`/products?${params.toString()}`);
  }

  function setVariants(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("variants", value);
    else params.delete("variants");
    params.delete("page");
    router.push(`/products?${params.toString()}`);
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
        placeholder="SKU veya ürün adı ara..."
        style={{ flex: "1 1 260px", minWidth: 220 }}
      />
      <button className="btn-secondary" onClick={submit}>Ara</button>
      <select value={searchParams.get("marketplace") ?? ""} onChange={(e) => setMarketplace(e.target.value)}>
        <option value="">Tüm bağlantılar</option>
        <option value="ozon">Sadece Ozon&apos;a bağlı</option>
        <option value="toptantr">Sadece toptantr&apos;a bağlı</option>
        <option value="both">İkisine de bağlı</option>
        <option value="none">Hiçbirine bağlı değil</option>
      </select>
      <select value={searchParams.get("stock") ?? "in"} onChange={(e) => setStock(e.target.value)}>
        <option value="in">Stokta var</option>
        <option value="out">Stokta yok</option>
        <option value="all">Stok: hepsi</option>
      </select>
      <select value={searchParams.get("variants") ?? ""} onChange={(e) => setVariants(e.target.value)}>
        <option value="">Varyant: hepsi</option>
        <option value="1">1 varyant</option>
        <option value="2">2 varyant</option>
        <option value="3">3 varyant</option>
        <option value="4">4 varyant</option>
        <option value="5">5+ varyant</option>
      </select>
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
