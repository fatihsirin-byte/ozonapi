"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReturnsSyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/returns/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Senkronizasyon başarısız");
        return;
      }
      setMessage(`${data.count} iade kaydı senkronize edildi`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button className="btn-secondary" disabled={loading} onClick={handleSync}>
        {loading ? "Senkronize ediliyor..." : "Senkronize Et (son 90 gün)"}
      </button>
      {message && <div className="hint">{message}</div>}
    </div>
  );
}
