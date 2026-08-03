"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OrdersToolbar() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/orders/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Senkronizasyon başarısız");
        return;
      }
      setMessage(`${data.orderCount} sipariş, ${data.transactionCount} finans işlemi senkronize edildi`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button className="btn-primary" disabled={loading} onClick={handleSync}>
        {loading ? "Senkronize ediliyor..." : "Senkronize Et (son 30 gün)"}
      </button>
      {message && <div className="hint">{message}</div>}
    </div>
  );
}
