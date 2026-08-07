"use client";

import { useState } from "react";

export function RealWeightInput({
  offerId,
  initialConfirmed,
  initialWeightGrams,
}: {
  offerId: string;
  initialConfirmed: boolean;
  initialWeightGrams: number | null;
}) {
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [weightGrams, setWeightGrams] = useState(initialWeightGrams);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = Number(input);
    if (!value || value <= 0) {
      setError("Geçerli bir ağırlık girin");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(offerId)}/confirm-weight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realWeightGrams: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kaydedilemedi");
        return;
      }
      setWeightGrams(value);
      setConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSaving(false);
    }
  }

  if (confirmed) {
    return (
      <span className="hint" title="Gerçek ağırlık daha önce girildi, fiyat buna göre hesaplandı">
        ✓ {weightGrams}g (teyitli)
      </span>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="number"
        placeholder="Gerçek ağırlık (g)"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        style={{ width: 110 }}
      />
      <button type="button" className="btn-secondary" disabled={saving} onClick={save}>
        {saving ? "..." : "Kaydet"}
      </button>
      {error && <span className="hint" style={{ color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}
