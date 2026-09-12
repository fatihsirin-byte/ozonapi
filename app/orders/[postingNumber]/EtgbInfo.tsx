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

// ASE durumu artık sunucu bileşeninden (page.tsx) PROP olarak geliyor, kendi fetch'iyle DEĞİL
// (2026-09-13 code review'da tespit edildi): burada ayrıca çekilseydi, "ASE'ye Gönder" butonuna
// basılıp gönderim bittiğinde (bkz. AseShipmentButton.tsx router.refresh() çağrısı) bu bileşen
// sayfa yeniden yüklenene kadar BAYAT kalırdı — iki bileşen aynı anda farklı durum gösterirdi.
// ETGB'nin kendisi (Ozon/ASE&GBS'nin otomatik oluşturduğu resmi beyan) hâlâ zamanla değişebildiği
// için o kısım eskisi gibi kendi fetch'ini yapmaya devam ediyor.
export function EtgbInfo({ postingNumber, aseShipment }: { postingNumber: string; aseShipment: AseShipmentData | null }) {
  const [loading, setLoading] = useState(true);
  const [etgb, setEtgb] = useState<EtgbData | null>(null);

  useEffect(() => {
    fetch(`/api/orders/${encodeURIComponent(postingNumber)}/etgb`)
      .then((r) => r.json())
      .then((data) => setEtgb(data.etgb))
      .finally(() => setLoading(false));
  }, [postingNumber]);

  // ASE (xlive.ase.com.tr) gümrük bildirimi — "ASE'ye Gönder" butonuyla (bkz. AseShipmentButton.tsx)
  // ELLE tetiklenir (2026-09-13, kullanıcı talebi: otomatik gönderim kaldırıldı). Burası ETGB'nin
  // kendisi değil, bizim ASE'ye YOLLADIĞIMIZ bildirimin sonucunu gösteren salt-okunur bir özet.
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
