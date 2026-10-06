"use client";

import { useState } from "react";

// Kullanıcı talebi (2026-09-25): "örnek 2 tane sipariş numarası ekle üstüne tıklarsam kopyalasın"
// — CopyableField.tsx'teki gibi ayrı bir "Kopyala" butonu YERİNE, numaranın KENDİSİNE tıklanınca
// kopyalıyor (kullanıcı özellikle "üstüne tıklarsam" dedi).
export function CopyablePostingNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Kopyalamak için tıkla"
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: copied ? "var(--success)" : "var(--muted)",
        textDecoration: "underline",
        fontSize: 12,
        font: "inherit",
      }}
    >
      {copied ? "✓ Kopyalandı" : value}
    </button>
  );
}
