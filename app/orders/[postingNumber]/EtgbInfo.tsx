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
  // ASE'nin kendi gümrük beyanı/iptal/ölçüm durumu (bkz. src/ase/statusPolling.ts) — Ozon/ASE&GBS'nin
  // oluşturduğu resmi ETGB'den (yukarıdaki "etgb" state'i) FARKLI bir kaynak, ASE'nin doğrudan API
  // üzerinden bize verdiği kendi durum bilgisi (2026-09-16, Devrim Eriş ile görüşme sonrası).
  customDeclarationCode: string | null;
  customDeclarationDate: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  measuredWeightKg: number | null;
  // Sipariş kargoya verilmiş/teslim edilmiş sayılan durumlardan biri mi (bkz.
  // ASE_ELIGIBLE_STATUSES) — periyodik ASE kontrolü artık "success" bayrağından (sadece panelin
  // kendi butonuyla gönderdiği siparişlerde dolu) BAĞIMSIZ, TÜM bu tür siparişleri kontrol ediyor
  // (2026-09-16, kullanıcı talebi: "geçmişteki aseyle gönder demediklerimizi de sorgula"). Bu alan
  // olmadan, panelin butonuyla hiç gönderilmemiş ama hâlâ bekleyen bir sipariş için "henüz beyan
  // çıkmadı" mesajı hiç görünmezdi (2026-09-16 code review'da tespit edildi).
  isAseTracked: boolean;
}

// ASE durumu artık sunucu bileşeninden (page.tsx) PROP olarak geliyor, kendi fetch'iyle DEĞİL
// (2026-09-13 code review'da tespit edildi): burada ayrıca çekilseydi, ASE'ye gönderim bittiğinde
// (bkz. InvoiceAndAseButton.tsx router.refresh() çağrısı) bu bileşen sayfa yeniden yüklenene kadar
// BAYAT kalırdı — iki bileşen aynı anda farklı durum gösterirdi.
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

  // ASE (xlive.ase.com.tr) gümrük bildirimi — fatura onaylanınca (bkz. InvoiceAndAseButton.tsx)
  // otomatik tetiklenir (2026-09-16, kullanıcı talebi: "tek buton"). Burası ETGB'nin
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

  // ASE'nin kendi beyanname/iptal/ölçüm durumu — periyodik olarak arka planda sorgulanıyor (bkz.
  // src/ase/statusPolling.ts), o yüzden gönderim başarılı olsa bile bir süre boşluk gösterebilir.
  const aseDeclarationStatus = aseShipment?.cancelledAt ? (
    <div className="hint" style={{ color: "var(--danger)", fontWeight: 500 }}>
      ASE&apos;de İPTAL — {new Date(aseShipment.cancelledAt).toLocaleString("tr-TR")}
      {aseShipment.cancelReason ? ` (${aseShipment.cancelReason})` : ""}
    </div>
  ) : aseShipment?.customDeclarationCode ? (
    <div className="hint">
      ASE beyanname: {aseShipment.customDeclarationCode}
      {aseShipment.customDeclarationDate
        ? ` — ${new Date(aseShipment.customDeclarationDate).toLocaleDateString("tr-TR")}`
        : ""}
    </div>
  ) : aseShipment?.isAseTracked ? (
    <div className="hint">ASE beyanname durumu: henüz beyan çıkmadı</div>
  ) : null;
  const aseWeightInfo =
    aseShipment?.measuredWeightKg != null ? (
      <div className="hint">ASE ölçümü: {aseShipment.measuredWeightKg} kg</div>
    ) : null;

  if (loading) return <div className="hint">ETGB kontrol ediliyor...</div>;
  if (!etgb) {
    return (
      <div>
        <div className="hint">
          Henüz ETGB oluşmamış — kargo süreci tamamlanınca Ozon/ASE&GBS tarafından otomatik oluşturulur.
        </div>
        {aseStatus}
        {aseDeclarationStatus}
        {aseWeightInfo}
      </div>
    );
  }

  return (
    <div>
      <a href={etgb.etgb.url} target="_blank" rel="noreferrer">
        ETGB {etgb.etgb.number} — {new Date(etgb.etgb.date).toLocaleDateString("tr-TR")}
      </a>
      {aseStatus}
      {aseDeclarationStatus}
      {aseWeightInfo}
    </div>
  );
}
