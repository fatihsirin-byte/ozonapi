"use client";

import { useState } from "react";

export function LabelDownloadButton({ postingNumber }: { postingNumber: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/label`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Etiket alınamadı");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-secondary" disabled={loading} onClick={download}>
        {loading ? "Etiket alınıyor..." : "Kargo Etiketini İndir"}
      </button>
      {error && <div className="hint" style={{ color: "var(--danger)", marginTop: 6 }}>{error}</div>}
    </div>
  );
}
