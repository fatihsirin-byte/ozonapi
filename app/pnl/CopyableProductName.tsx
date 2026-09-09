"use client";

import { useState } from "react";
import { stripVariantSuffix } from "@/utils/productName";

// Tıklayınca ürünün sade (varyant eki olmadan) Rusça adını panoya kopyalar — Ozon panelinde
// ürünü aramak için kullanılıyor (2026-09-09, kullanıcı talebi).
export function CopyableProductName({ name, nameRu }: { name: string; nameRu: string | null }) {
  const [copied, setCopied] = useState(false);
  const clean = stripVariantSuffix(nameRu ?? name);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(clean);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // panoya erişim reddedildiyse sessizce yok say
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Kopyalamak için tıkla"
      style={{
        background: "none",
        border: "none",
        padding: 0,
        font: "inherit",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {name}
      {copied && <span style={{ marginLeft: 6, color: "var(--success)", fontSize: 12 }}>Kopyalandı</span>}
    </button>
  );
}
