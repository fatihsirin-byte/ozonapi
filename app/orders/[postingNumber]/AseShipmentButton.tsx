"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  postingNumber: string;
  // Fatura numarası kesinleşmeden (bkz. Order.parasutInvoiceNoConfirmed) ASE'ye gönderimin bir
  // anlamı yok — sendOrderToAse zaten sessizce hiçbir şey yapmıyor, ama butonu da o zamana kadar
  // devre dışı bırakıp kullanıcının "tıkladım, hiçbir şey olmadı" izlenimine kapılmasını önlüyoruz.
  invoiceConfirmed: boolean;
  initialSentAt: string | null;
  initialSuccess: boolean | null;
  initialMessage: string | null;
}

// ASE'ye (gümrük/ETGB) bildirim — SADECE bu butonla, elle gönderilir (2026-09-13, kullanıcı talebi:
// önceki sürüm hem fatura PDF durumu her kontrol edildiğinde hem 15 dakikalık senkronizasyon
// cron'unda kendiliğinden "fatura numarası kesinleşmiş ama gönderilmemiş" siparişleri bulup
// gönderiyordu — kullanıcı bunu öngörülemez buldu, "fatura kestikten sonra buton gelsin" istedi).
export function AseShipmentButton({ postingNumber, invoiceConfirmed, initialSentAt, initialSuccess, initialMessage }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sentAt, setSentAt] = useState(initialSentAt);
  const [success, setSuccess] = useState(initialSuccess);
  const [message, setMessage] = useState(initialMessage);

  async function handleSend() {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/ase-shipment`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSuccess(false);
        setMessage(data.error ?? "Gönderilemedi");
        setSentAt(new Date().toISOString());
        return;
      }
      setSentAt(data.sentAt);
      setSuccess(data.success);
      setMessage(data.message);
      // Sayfadaki EtgbInfo bileşeni ASE durumunu kendi fetch'i yerine sunucudan (page.tsx) PROP
      // olarak alıyor (2026-09-13 code review'da tespit edildi) — o yüzden burada gönderim
      // bitince router.refresh() ile sunucu bileşenini tazeleyip EtgbInfo'nun da güncel durumu
      // görmesini sağlıyoruz, aksi halde iki bileşen sayfa yenilenene kadar farklı şey gösterirdi.
      router.refresh();
    } catch (err) {
      setSuccess(false);
      setMessage(err instanceof Error ? err.message : "Bilinmeyen hata");
      setSentAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }

  if (!invoiceConfirmed) {
    return (
      <button className="btn-secondary" disabled title="Fatura numarası kesinleşmeden ASE'ye gönderilemez">
        ASE'ye Gönder
      </button>
    );
  }

  // Zaten başarıyla gönderildiyse buton tekrar aktif gösterilmiyor — sendOrderToAse tekrar
  // tıklansa bile ikinci gönderime izin vermiyor (bkz. src/ase/orderShipment.ts), bu yüzden
  // kullanıcıya doğrudan sonucu gösteriyoruz.
  if (success) {
    return (
      <span className="hint" style={{ color: "var(--success)" }}>
        ASE&apos;ye gönderildi ✓{sentAt ? ` (${new Date(sentAt).toLocaleString("tr-TR")})` : ""}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button className="btn-secondary" disabled={loading} onClick={handleSend}>
        {loading ? "Gönderiliyor..." : "ASE'ye Gönder"}
      </button>
      {success === false && (
        <span className="hint" style={{ color: "var(--danger)" }}>
          {message ?? "Gönderim başarısız"}
        </span>
      )}
    </div>
  );
}
