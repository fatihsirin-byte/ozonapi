"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Alış fiyatı boş kalmış kalemlerde tabloda satır içinde doldurma alanı — kaydedince sadece
// bizim DB'mizdeki costPrice yazılır (Ozon'a canlı fiyat gönderilmez, bkz. setCostPriceOnly),
// sayfa yenilenip kâr/marj o kalem için yeniden hesaplanır (2026-08-24, kullanıcı talebi).
export function CostPriceCell({ offerId }: { offerId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
        <button className="btn-secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setEditing(true)}>
          Alış fiyatı gir
        </button>
        {/* Ağırlık/boyut gibi hesaplama girdileri sadece ürün sayfasında tam olarak var — modalı
            burada eksik veriyle tekrar kurmak yerine, hesaplayıcının zaten çalıştığı ürün
            sayfasına yönlendiriyoruz (2026-09-09, kullanıcı talebi: "fiyat hesaplayıcıyı kullan"). */}
        <a
          href={`/products/${encodeURIComponent(offerId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hint"
          style={{ fontSize: 11 }}
        >
          Fiyat Hesaplayıcı ↗
        </a>
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(offerId)}/cost-price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costPrice: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kaydedilemedi");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 4 }}>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="$"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: 70 }}
          autoFocus
        />
        <button className="btn-primary" style={{ padding: "2px 8px", fontSize: 12 }} disabled={saving || !value} onClick={handleSave}>
          {saving ? "..." : "Kaydet"}
        </button>
      </div>
      {error && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
    </div>
  );
}
