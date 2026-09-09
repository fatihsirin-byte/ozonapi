"use client";

import { useState } from "react";

// Bugün (TSİ) kesilmiş tüm faturaları tek ZIP olarak indirir (2026-09-09, kullanıcı talebi).
export function InvoicedTodayZipButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/parasut-invoices/today-zip");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "İndirilemedi");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `faturalar-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn-primary" disabled={loading} onClick={handleDownload}>
        {loading ? "Hazırlanıyor..." : "Hepsini ZIP İndir"}
      </button>
      {error && <div className="hint" style={{ color: "var(--danger)", marginTop: 4 }}>{error}</div>}
    </div>
  );
}
