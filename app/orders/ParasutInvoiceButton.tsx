"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  postingNumber: string;
  initialInvoiceNo: string | null;
  initialPrintUrl: string | null;
}

type PdfStatus = "checking" | "ready" | "processing" | "error";

const AUTO_CHECK_INTERVAL_MS = 10_000;

// Paraşüt'te GERÇEK bir satış faturası oluşturur — geri alınamaz, bu yüzden tıklamadan önce
// onay isteniyor. Kesildikten sonra buton "Faturayı Aç" linkine dönüşür (2026-09-09, kullanıcı
// talebi). Fatura kesilir kesilmez Paraşüt'ün e-Arşiv'i GİB'e gönderip resmileştirmesi
// (panelde "GÖNDERİLİYOR" durumu) birkaç saniye/dakika sürebiliyor — bu esnada PDF linki henüz
// hazır olmuyor (2026-09-09'da canlıda "ActiveRecord::RecordNotFound" hatasıyla tespit edildi).
// Bu yüzden durumu canlı sorguluyoruz; hazır olana kadar buton devre dışı "İşleniyor..." gösterir
// ve arkada TEK bir interval ile 10 saniyede bir kendiliğinden tekrar kontrol eder — geçici bir
// ağ hatası (pdfStatus "error" olsa da) kontrolü kalıcı olarak DURDURMAZ, sadece "ready" olunca
// durur (2026-09-10, kullanıcı talebi + code review'da "hata sonrası otomatik kontrol tamamen
// duruyor" bulgusuna karşılık; tekrar deneme SADECE gerçekten başarısız olduysa yeni e-Arşiv
// başvurusu yapar, bkz. src/parasut/eArchives.ts — burası sadece PDF durumunu okur).
export function ParasutInvoiceButton({ postingNumber, initialInvoiceNo, initialPrintUrl }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState(initialInvoiceNo);
  const [panelUrl, setPanelUrl] = useState(initialPrintUrl ? initialPrintUrl.replace(/\/print$/, "") : null);
  const [hasInvoice, setHasInvoice] = useState(Boolean(initialPrintUrl || initialInvoiceNo));
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>("checking");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const statusRef = useRef<PdfStatus>("checking");

  async function checkPdfStatus() {
    setPdfStatus((prev) => (prev === "ready" ? prev : "checking"));
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/parasut-invoice/pdf`);
      const data = await res.json();
      if (data.status === "ready" && data.pdfUrl) {
        setPdfUrl(data.pdfUrl);
        setPdfStatus("ready");
      } else {
        setPdfStatus("processing");
      }
    } catch {
      setPdfStatus("error");
    }
  }

  useEffect(() => {
    statusRef.current = pdfStatus;
  }, [pdfStatus]);

  useEffect(() => {
    if (!hasInvoice) return;
    checkPdfStatus();
    const interval = setInterval(() => {
      if (statusRef.current === "ready") {
        clearInterval(interval);
        return;
      }
      checkPdfStatus();
    }, AUTO_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInvoice]);

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
      setPanelUrl(data.printUrl ? String(data.printUrl).replace(/\/print$/, "") : null);
      setHasInvoice(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  if (hasInvoice) {
    return (
      <div>
        {pdfStatus === "ready" && pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
            <button className="btn-secondary">Faturayı Aç {invoiceNo ? `(${invoiceNo})` : ""} ↗</button>
          </a>
        )}
        {pdfStatus === "checking" && (
          <button className="btn-secondary" disabled>Kontrol ediliyor...</button>
        )}
        {pdfStatus === "processing" && (
          <button className="btn-secondary" disabled>İşleniyor... (birkaç dakika sürebilir)</button>
        )}
        {pdfStatus === "error" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="hint" style={{ color: "var(--danger)" }}>Durum kontrol edilemedi</span>
            <button className="btn-secondary" onClick={checkPdfStatus}>Tekrar Dene</button>
          </div>
        )}
        {/* PDF henüz hazır değilse (ya da hiç hazır olmayacaksa) faturayı Paraşüt panelinden
            görüntülemek için her zaman çalışan bir yedek link — gerçek fatura zaten oluşmuş
            olduğu için kullanıcının ona ulaşabileceği bir yol HER ZAMAN olmalı (2026-09-09,
            code review'da "PDF hazır olmazsa erişim yolu kalmıyor" bulgusuna karşılık eklendi). */}
        {pdfStatus !== "ready" && panelUrl && (
          <div style={{ marginTop: 4 }}>
            <a href={panelUrl} target="_blank" rel="noopener noreferrer" className="hint">
              Paraşüt panelinde görüntüle ↗
            </a>
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
