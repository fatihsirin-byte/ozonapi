"use client";

import { useEffect, useState } from "react";

interface LinePreview {
  offerId: string;
  name: string;
  quantity: number;
  unitCostUsd: number;
  unitPriceTry: number;
  usedFallbackCost: boolean;
}

interface Preview {
  lines: LinePreview[];
  postingNumbers: string[];
  totalTry: number;
  fxRate: number;
  dateLabel: string;
}

interface InvoiceResult {
  invoiceId: string;
  invoiceNo: string | null;
  postingNumbers: string[];
  totalTry: number;
  printUrl: string;
  eInvoiceStatus: "approved" | "pending" | "failed" | "not_required";
  eInvoiceError: string | null;
}

function formatTry(value: number): string {
  return value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "YYYY-MM-DD" -> "GG.AA.YYYY" — kullanıcı bu tarihi, GERÇEK bir fatura onaylamadan önce hangi
// güne ait olduğunu net görebilsin diye her yerde gösteriyoruz.
function formatDateLabel(dateLabel: string): string {
  const [y, m, d] = dateLabel.split("-");
  return `${d}.${m}.${y}`;
}

// Aladdin'den Fatih Gezgin'e kesilen günlük İÇ fatura — kullanıcı kararı (2026-09-16): "önce
// elle/manuel buton". Bu yüzden bilerek bir cron YOK, sadece bu sayfadan elle tetiklenir. Önce
// ÖNİZLEME gösterilir (hiçbir şey oluşturulmadan) — kullanıcı tutarları/ürünleri gözden geçirip
// onayladıktan SONRA GERÇEK faturayı oluşturur.
export function AladdinInvoicePanel() {
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<InvoiceResult | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/aladdin-invoice");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Önizleme alınamadı");
        return;
      }
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPreview();
  }, []);

  async function handleCreate() {
    if (!preview) return;
    if (
      !confirm(
        `${formatDateLabel(preview.dateLabel)} tarihli siparişler için Aladdin'den Fatih Gezgin'e ${formatTry(preview.totalTry)} TL tutarında, ${preview.lines.length} kalemlik GERÇEK bir satış faturası kesilecek. Bu işlem geri alınamaz. Onaylıyor musunuz?`,
      )
    ) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // ÖNEMLİ: önizlemede gösterilen TAM sipariş listesini geri gönderiyoruz — sunucu bunun
      // dışına ÇIKMIYOR, ta ki kullanıcı onayladığı tutardan farklı bir fatura kesilmesin diye
      // (2026-09-16 code review'da tespit edildi).
      const res = await fetch("/api/aladdin-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingNumbers: preview.postingNumbers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Fatura kesilemedi");
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setCreating(false);
    }
  }

  if (result) {
    return (
      <div className="card">
        <div style={{ color: "var(--success)", fontWeight: 500, marginBottom: 8 }}>
          Fatura kesildi ✓ {result.invoiceNo ? `(${result.invoiceNo})` : ""}
        </div>
        <div className="hint" style={{ marginBottom: 12 }}>
          {formatTry(result.totalTry)} TL — {result.postingNumbers.length} sipariş için alış faturası numarası
          kaydedildi.
        </div>
        {result.eInvoiceStatus === "pending" && (
          <div className="hint" style={{ color: "var(--warning)", marginBottom: 12 }}>
            e-Fatura Paraşüt&apos;e gönderildi, GİB onayı bekleniyor — birkaç dakika sonra Paraşüt panelinden
            kontrol edin.
          </div>
        )}
        {result.eInvoiceStatus === "failed" && (
          <div className="hint" style={{ color: "var(--danger)", marginBottom: 12 }}>
            Fatura Paraşüt&apos;te oluştu ama e-Fatura&apos;ya dönüştürme adımı başarısız oldu
            {result.eInvoiceError ? `: ${result.eInvoiceError}` : "."} Paraşüt panelinden elle tamamlamanız
            gerekebilir.
          </div>
        )}
        <button
          className="btn-secondary"
          type="button"
          onClick={() => window.open(result.printUrl, "_blank", "noopener,noreferrer")}
        >
          Faturayı Görüntüle ↗
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="hint">Faturalar taranıyor...</div>;
  }

  if (error) {
    return (
      <div className="card">
        <div className="hint" style={{ color: "var(--danger)", marginBottom: 8 }}>
          {error}
        </div>
        <button className="btn-secondary" onClick={loadPreview}>
          Tekrar Dene
        </button>
      </div>
    );
  }

  if (!preview || preview.lines.length === 0) {
    const datePart = preview ? `${formatDateLabel(preview.dateLabel)} tarihinde` : "Bu gün için";
    return <div className="empty-state">{datePart} henüz faturalanmış (Ozon müşterisine kesilmiş) sipariş yok.</div>;
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>
          {formatDateLabel(preview.dateLabel)} tarihinde faturalanan {preview.postingNumbers.length} sipariş,{" "}
          {preview.lines.length} farklı ürün
        </div>
        <div className="hint">
          Fiyatlar: ürünün alış fiyatı (COGS) × 1,40 (%40 kâr payı) × güncel USD/TL kuru ({preview.fxRate}). Alış
          fiyatı boş olan ürünlerde 5 USD varsayılan kullanıldı (aşağıda işaretli).
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Ürün</th>
            <th>Adet</th>
            <th>Birim Alış (USD)</th>
            <th>Birim Fiyat (TL)</th>
            <th>Toplam (TL)</th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((line) => (
            <tr key={line.offerId}>
              <td>{line.name}</td>
              <td>{line.quantity}</td>
              <td>
                ${line.unitCostUsd}
                {line.usedFallbackCost && (
                  <span className="hint" style={{ color: "var(--danger)" }}>
                    {" "}
                    (varsayılan)
                  </span>
                )}
              </td>
              <td>{formatTry(line.unitPriceTry)}</td>
              <td>{formatTry(line.unitPriceTry * line.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
        <button className="btn-primary" disabled={creating} onClick={handleCreate}>
          {creating ? "Kesiliyor..." : `Faturayı Şimdi Oluştur (${formatTry(preview.totalTry)} TL)`}
        </button>
        <button className="btn-secondary" disabled={creating} onClick={loadPreview}>
          Önizlemeyi Yenile
        </button>
      </div>
    </div>
  );
}
