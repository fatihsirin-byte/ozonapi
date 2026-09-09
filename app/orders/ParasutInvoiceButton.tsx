"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  postingNumber: string;
  initialInvoiceNo: string | null;
  initialPrintUrl: string | null;
}

// Paraşüt'te GERÇEK bir satış faturası oluşturur — geri alınamaz, bu yüzden tıklamadan önce
// onay isteniyor. Kesildikten sonra buton "İndir" linkine dönüşür (2026-09-09, kullanıcı talebi).
export function ParasutInvoiceButton({ postingNumber, initialInvoiceNo, initialPrintUrl }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState(initialInvoiceNo);
  const [printUrl, setPrintUrl] = useState(initialPrintUrl);
  const [eArchiveWarning, setEArchiveWarning] = useState(false);

  async function handleCreate() {
    if (!confirm("Paraşüt'te bu sipariş için GERÇEK bir satış faturası kesilecek. Onaylıyor musunuz?")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/parasut-invoice`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Fatura kesilemedi");
        return;
      }
      setInvoiceNo(data.invoiceNo);
      setPrintUrl(data.printUrl);
      setEArchiveWarning(Boolean(data.eArchiveFailed));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  if (printUrl) {
    return (
      <div>
        <a href={printUrl} target="_blank" rel="noopener noreferrer">
          <button className="btn-secondary">Faturayı Aç {invoiceNo ? `(${invoiceNo})` : ""} ↗</button>
        </a>
        {eArchiveWarning && (
          <div className="hint" style={{ color: "var(--danger)", marginTop: 4 }}>
            Fatura oluştu ama e-Arşiv adımı başarısız oldu — Paraşüt panelinden kontrol edin.
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <button className="btn-primary" disabled={loading} onClick={handleCreate}>
        {loading ? "Kesiliyor..." : "Paraşüt'te Fatura Kes"}
      </button>
      {error && <div className="hint" style={{ color: "var(--danger)", marginTop: 4 }}>{error}</div>}
    </div>
  );
}
