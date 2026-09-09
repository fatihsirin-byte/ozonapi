"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function PnlToolbar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // CSV her zaman o an ekranda aktif olan filtreyi (missingCost/shippingLoss) yansıtsın diye
  // sayfanın kendi query string'i aynen CSV route'una da taşınıyor (2026-09-09, kullanıcı talebi).
  const csvHref = `/api/orders/pnl-report/csv${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

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
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-secondary" disabled={loading} onClick={handleSync}>
          {loading ? "Senkronize ediliyor..." : "Senkronize Et (son 30 gün)"}
        </button>
        <a href={csvHref}>
          <button className="btn-primary">CSV İndir</button>
        </a>
      </div>
      {message && <div className="hint">{message}</div>}
    </div>
  );
}
