"use client";

import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  // ms>0 ama totalMinutes 0'a yuvarlanabiliyor (ör. son 59 saniye) — bu durumda "0 dk kaldı"
  // yazmak süre DOLMUŞ gibi yanlış bir izlenim verirdi, hâlbuki hâlâ (az da olsa) süre var
  // (2026-09-11'de code review'da tespit edildi).
  if (totalMinutes <= 0) return "1 dk'dan az kaldı";
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} gün ${hours} sa kaldı`;
  if (hours > 0) return `${hours} sa ${minutes} dk kaldı`;
  return `${minutes} dk kaldı`;
}

// Ozon'un kargoya verme SÜRESİ (shipment_date) dolana kadar kalan zamanı canlı gösteren geri
// sayım — dakikada bir kendiliğinden güncelleniyor (2026-09-11, kullanıcı talebi: "sevkiyata kalan
// süreyi... countdown gibi gösterelim"). Gecikmiş/durumu artık alakasız (kargoya zaten verilmiş)
// siparişler için bu bileşen HİÇ render edilmiyor — o kararı zaten server tarafında
// getShipmentDelayInfo + SHIPPED_OR_DONE_STATUSES veriyor (bkz. app/orders/page.tsx), burası
// sadece "hâlâ süre var" durumundaki siparişler için çağrılıyor.
export function ShipDeadlineCountdown({ deadlineIso }: { deadlineIso: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // İlk render'ı server ile AYNI (deterministik) tutmak için "now" başta null — istemcide mount
    // olur olmaz gerçek zamana geçiliyor, aksi halde hydration uyuşmazlığı (server render anı ile
    // istemci render anı farklı olacağı için) React uyarısı/çakışmasına yol açardı.
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (now == null) return <span className="hint">…</span>;

  const diff = new Date(deadlineIso).getTime() - now;
  if (diff <= 0) {
    // Sayaç negatife düştüyse (kullanıcı sayfayı uzun süre açık tuttu) — bu artık "Gecikenler"
    // filtresinin alanı, burada sadece nötr bir metin gösteriliyor, kırmızı gecikme uyarısı
    // page.tsx'teki server-render edilen delay.isDelayed mantığından geliyor.
    return <span className="hint">süre doldu</span>;
  }
  return (
    <span className="hint" style={{ color: diff < 24 * 60 * 60 * 1000 ? "var(--danger)" : undefined }}>
      {formatRemaining(diff)}
    </span>
  );
}
