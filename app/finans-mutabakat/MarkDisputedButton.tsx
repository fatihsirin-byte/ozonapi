"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "İtiraz Edilmedi (Yeni)" sekmesindeki tüm siparişleri tek seferde "disputed" işaretler — o
// anki gerçek kargo tutarını baseline olarak dondurur, periyodik kontrol (sync-orders-cron.ts)
// bu baseline'a göre Ozon'un düzeltip düzeltmediğine bakar (2026-09-28, kullanıcı talebi).
export function MarkDisputedButton({ postingNumbers }: { postingNumbers: string[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!confirm(`${postingNumbers.length} sipariş "İtiraz Edildi" olarak işaretlensin mi?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/shipping-dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingNumbers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "İşaretlenemedi");
        return;
      }
      router.refresh();
    } catch {
      setError("İşaretlenemedi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <button className="btn-secondary" onClick={handleClick} disabled={saving}>
        {saving ? "İşaretleniyor…" : `Tümünü İtiraz Edildi İşaretle (${postingNumbers.length})`}
      </button>
      {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
