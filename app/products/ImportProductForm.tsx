"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportProductForm() {
  const router = useRouter();
  const [offerId, setOfferId] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    if (!offerId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId: offerId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "İçe aktarılamadı");
        return;
      }
      router.push(`/products/${offerId.trim()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        Ozon'dan İçe Aktar
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          placeholder="Ozon'daki offer_id (SKU)"
          value={offerId}
          onChange={(e) => setOfferId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleImport()}
          style={{ width: 220 }}
        />
        <button className="btn-primary" disabled={loading || !offerId.trim()} onClick={handleImport}>
          {loading ? "Aktarılıyor..." : "İçe Aktar"}
        </button>
        <button className="btn-secondary" onClick={() => setOpen(false)}>
          Vazgeç
        </button>
      </div>
      {error && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
    </div>
  );
}
