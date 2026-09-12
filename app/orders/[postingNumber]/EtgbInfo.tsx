"use client";

import { useEffect, useState } from "react";

interface EtgbData {
  posting_number: string;
  etgb: { number: string; date: string; url: string };
}

interface AseShipmentData {
  sentAt: string | null;
  success: boolean | null;
  message: string | null;
}

// Salt-okunur — ETGB (Türk gümrük beyannamesi) Ozon/kargo firması (ASE&GBS) tarafından kargo
// süreci içinde otomatik oluşturuluyor, biz burada sadece siparişe bağlı olanı gösteriyoruz.
export function EtgbInfo({ postingNumber }: { postingNumber: string }) {
  const [loading, setLoading] = useState(true);
  const [etgb, setEtgb] = useState<EtgbData | null>(null);
  const [aseShipment, setAseShipment] = useState<AseShipmentData | null>(null);

  useEffect(() => {
    fetch(`/api/orders/${encodeURIComponent(postingNumber)}/etgb`)
      .then((r) => r.json())
      .then((data) => {
        setEtgb(data.etgb);
        setAseShipment(data.aseShipment ?? null);
      })
      .finally(() => setLoading(false));
  }, [postingNumber]);

  // ASE (xlive.ase.com.tr) gümrük bildirimi — fatura Paraşüt'te kesinleşince otomatik gönderiliyor
  // (bkz. src/ase/orderShipment.ts). Bu, ETGB'nin kendisi değil — bizim ASE'ye YOLLADIĞIMIZ
  // bildirimin sonucu, salt-okunur bir gösterge.
  const aseStatus =
    aseShipment?.sentAt == null ? null : aseShipment.success ? (
      <div className="hint" style={{ color: "var(--success)" }}>
        ASE&apos;ye gönderildi ✓ ({new Date(aseShipment.sentAt).toLocaleString("tr-TR")})
      </div>
    ) : (
      <div className="hint" style={{ color: "var(--danger)" }}>
        ASE gönderim hatası: {aseShipment.message ?? "bilinmeyen hata"}
      </div>
    );

  if (loading) return <div className="hint">ETGB kontrol ediliyor...</div>;
  if (!etgb) {
    return (
      <div>
        <div className="hint">
          Henüz ETGB oluşmamış — kargo süreci tamamlanınca Ozon/ASE&GBS tarafından otomatik oluşturulur.
        </div>
        {aseStatus}
      </div>
    );
  }

  return (
    <div>
      <a href={etgb.etgb.url} target="_blank" rel="noreferrer">
        ETGB {etgb.etgb.number} — {new Date(etgb.etgb.date).toLocaleDateString("tr-TR")}
      </a>
      {aseStatus}
    </div>
  );
}
