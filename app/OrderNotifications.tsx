"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface RecentOrderItem {
  offerId: string;
  quantity: number;
  price: string;
  name: string;
  thumbnail: string | null;
}

interface RecentOrder {
  postingNumber: string;
  amount: number;
  createdAt: string;
  items: RecentOrderItem[];
}

interface Toast extends RecentOrder {
  toastId: string;
}

const POLL_INTERVAL_MS = 20_000;

function formatMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function OrderNotifications() {
  const pathname = usePathname();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // İlk mount'ta "şu an"dan başlıyoruz ki sayfa açılışında geçmiş tüm siparişler toast olarak patlamasın.
  const sinceRef = useRef(new Date().toISOString());

  useEffect(() => {
    if (pathname === "/login") return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/orders/recent?since=${encodeURIComponent(sinceRef.current)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { orders: RecentOrder[]; checkedAt: string };
        if (cancelled) return;

        sinceRef.current = data.checkedAt;
        if (data.orders.length > 0) {
          setToasts((prev) => [
            ...prev,
            ...data.orders.map((o) => ({ ...o, toastId: `${o.postingNumber}-${o.createdAt}` })),
          ]);
        }
      } catch {
        // sessizce geç, bir sonraki pollde tekrar denenecek
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function dismiss(toastId: string) {
    setToasts((prev) => prev.filter((t) => t.toastId !== toastId));
  }

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.toastId), 15_000));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.length]);

  if (pathname === "/login" || toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <Link key={t.toastId} href={`/orders/${t.postingNumber}`} className="toast-card">
          <div className="toast-header">
            <span>🎉 Yeni Sipariş</span>
            <button
              className="toast-close"
              onClick={(e) => {
                e.preventDefault();
                dismiss(t.toastId);
              }}
            >
              ✕
            </button>
          </div>
          {t.items.map((item) => (
            <div key={item.offerId} className="toast-item">
              {item.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.thumbnail} alt="" width={40} height={40} className="toast-thumb" />
              ) : (
                <div className="toast-thumb" style={{ background: "var(--border)" }} />
              )}
              <div>
                <div className="toast-item-name">{item.name}</div>
                <div className="hint">{item.quantity} adet — {formatMoney(Number(item.price))}</div>
              </div>
            </div>
          ))}
          <div className="toast-amount">{formatMoney(t.amount)}</div>
        </Link>
      ))}
    </div>
  );
}
