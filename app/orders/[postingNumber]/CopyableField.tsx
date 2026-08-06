"use client";

import { useState } from "react";

export function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="hint">{label}</div>
      <div className="value" style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
        <span>{value}</span>
        <button
          type="button"
          className="btn-secondary"
          style={{ padding: "2px 8px", fontSize: 12 }}
          onClick={copy}
        >
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
    </div>
  );
}
