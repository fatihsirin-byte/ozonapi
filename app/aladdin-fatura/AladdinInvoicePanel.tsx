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
  ordersInvoicedTodayCount: number;
  existingInvoices: Array<{ invoiceNo: string | null; printUrl: string; invoiceId: string | null }>;
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
        <div style={{ display: "flex", gap: 8 }}>
          {/* Kullanıcı bulgusu (2026-09-17): bu link Paraşüt'te Aladdin şirketi seçili DEĞİLSE
              "ActiveRecord::RecordNotFound" veriyor — kullanıcının tarayıcı oturumuna bağımlı. */}
          <button
            className="btn-secondary"
            type="button"
            onClick={() => window.open(result.printUrl, "_blank", "noopener,noreferrer")}
          >
            Paraşüt&apos;te Görüntüle ↗
          </button>
          {/* Kullanıcı talebi: "kendin pdf görüntüleyici göm" — PDF'i BİZİM sunucumuz çekip
              gösteriyor, kullanıcının Paraşüt'te hangi şirketi seçtiğinden BAĞIMSIZ. */}
          <button
            className="btn-primary"
            type="button"
            onClick={() => window.open(`/api/aladdin-invoice/pdf?invoiceId=${encodeURIComponent(result.invoiceId)}`, "_blank", "noopener,noreferrer")}
          >
            PDF Görüntüle
          </button>
        </div>
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
    // Sıfır satır İKİ farklı anlama gelebilir — "bu gün hiç Ozon müşterisine fatura kesilmemiş" ile
    // "bu gün faturalanan siparişler var ama işlenecek bir şey kalmamış" birbirinden çok farklı,
    // birini diğeriyle karıştırmak kullanıcıyı yanlışlıkla "sistem bugünü hiç görmüyor" sanmaya
    // iterdi (2026-09-17 code review'da tespit edildi, aynı gün yaşanan gerçek bir karışıklığa
    // karşılık). İKİNCİ durumun KESİN sebebini iddia etmiyoruz (zaten Aladdin'e faturalanmış
    // olabilir, "Alış Fatura No" elle girilmiş olabilir, ya da sipariş sonradan bölünüp kalemleri
    // başka bir posting'e taşınmış olabilir — round 2 code review'da tespit edildi) — sadece
    // "işlenecek bir şey kalmadığını" söylüyoruz.
    const message =
      preview && preview.ordersInvoicedTodayCount > 0
        ? `${datePart} faturalanan ${preview.ordersInvoicedTodayCount} sipariş var ama hiçbiri için yeni işlenecek bir şey kalmamış.`
        : `${datePart} henüz faturalanmış (Ozon müşterisine kesilmiş) sipariş yok.`;
    return (
      <div className="empty-state">
        {message}
        {/* Kullanıcı talebi (2026-09-17): "kesilen faturayı göster" — önceden bu link sadece fatura
            kesme isteğinin tek seferlik ekran cevabında vardı, sayfa yenilenince kayboluyordu. */}
        {preview && preview.existingInvoices.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            {preview.existingInvoices.map((inv) => (
              <div key={inv.printUrl} style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => window.open(inv.printUrl, "_blank", "noopener,noreferrer")}
                >
                  {inv.invoiceNo ? `${inv.invoiceNo} — Paraşüt'te Görüntüle` : "Paraşüt'te Görüntüle"} ↗
                </button>
                {/* Kullanıcı talebi: "kendin pdf görüntüleyici göm" — Paraşüt'te hangi şirket seçili
                    olursa olsun çalışır, çünkü PDF'i sunucumuz kendi kimlik bilgileriyle çekiyor.
                    invoiceId NULL olabilir (bu özellikten ÖNCE kesilmiş eski faturalar) — o
                    durumda PDF butonu YOK, sadece harici Paraşüt linki gösteriliyor. */}
                {inv.invoiceId && (
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => window.open(`/api/aladdin-invoice/pdf?invoiceId=${encodeURIComponent(inv.invoiceId as string)}`, "_blank", "noopener,noreferrer")}
                  >
                    PDF Görüntüle
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
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
