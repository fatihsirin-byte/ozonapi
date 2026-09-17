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

// Kullanıcı talebi (2026-09-17): "yeni sekme yerine aşağıda açamaz mı" — PDF'i ayrı bir sekmede
// açmak yerine, aynı sayfada büyük bir <iframe> içinde gömülü gösteriyor. `url` null iken hiçbir
// şey render ETMİYOR (iframe'i her seferinde yeniden oluşturup gereksiz bir istek atmasın diye).
function PdfViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="btn-secondary" type="button" onClick={onClose}>
          Kapat ✕
        </button>
      </div>
      <iframe src={url} title="Fatura PDF" style={{ width: "100%", height: "85vh", border: "1px solid var(--border)", borderRadius: 8 }} />
    </div>
  );
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
  // Kullanıcı talebi (2026-09-17): "yeni sekme yerine aşağıda açamaz mı" — PDF'i ayrı bir sekmede
  // AÇMAK yerine, aynı sayfada bir <iframe> içinde GÖMÜLÜ gösteriyoruz. Tek seferde tek fatura
  // açık olabilir (aynı anda birden fazla PDF görüntüleme kullanım senaryosu yok, sade tutuluyor).
  const [openPdfUrl, setOpenPdfUrl] = useState<string | null>(null);
  // Kullanıcı talebi (2026-09-18): "tarih filtresi, geri dönük tek gün seçerek gidebilelim, fatura
  // var mı yok mu görürüz yoksa keseriz" — dateInput, <input type="date"> ile ANLIK düzenlenen
  // değer; selectedDate ise "Git"e basılıp GERÇEKTEN yüklenmiş olan tarih (boş = bugün, sunucu
  // varsayılanı). İkisi ayrı tutuluyor ki kullanıcı takvimde bir tarih seçip henüz "Git"e basmadan
  // ekranın "seçili tarih" sanıp yanlışlıkla o günü onayladığı bir fatura kesmesin.
  const [dateInput, setDateInput] = useState("");
  const [selectedDate, setSelectedDate] = useState("");

  async function loadPreview(date?: string) {
    setLoading(true);
    setError(null);
    try {
      const url = date ? `/api/aladdin-invoice?date=${encodeURIComponent(date)}` : "/api/aladdin-invoice";
      const res = await fetch(url);
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

  function handleGoToDate() {
    if (!dateInput) return;
    setSelectedDate(dateInput);
    loadPreview(dateInput);
  }

  function handleBackToToday() {
    setDateInput("");
    setSelectedDate("");
    loadPreview();
  }

  // Diğer aksiyon butonlarıyla (Faturayı Şimdi Oluştur/Önizlemeyi Yenile) AYNI şekilde `creating`
  // ile de kilitleniyor — aksi halde kullanıcı GERÇEK bir fatura kesme isteği daha bitmeden başka
  // bir güne geçebilir, o istek sonuçlanınca "Fatura kesildi" ekranı kullanıcının o an baktığı
  // FARKLI günün önizlemesini sessizce üstüne yazardı (2026-09-18 code review'da tespit edildi —
  // bu özelliğin bütün amacı "hangi günü onayladığından emin olmak" olduğu için özellikle riskli).
  const dateFilterBar = (
    <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span className="hint">Geçmiş bir günü kontrol et:</span>
      <input
        type="date"
        value={dateInput}
        disabled={loading || creating}
        onChange={(e) => setDateInput(e.target.value)}
        style={{ padding: 6, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "inherit" }}
      />
      <button className="btn-secondary" type="button" disabled={loading || creating || !dateInput} onClick={handleGoToDate}>
        Git
      </button>
      {selectedDate && (
        <button className="btn-secondary" type="button" disabled={loading || creating} onClick={handleBackToToday}>
          Bugüne Dön
        </button>
      )}
    </div>
  );

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
        {/* Kullanıcı talebi (2026-09-17): "artık Paraşüt'le görüntüle butonuna gerek yok" — harici
            link (kullanıcının tarayıcı oturumuna/Paraşüt'te seçili şirkete bağımlı, "ActiveRecord::
            RecordNotFound" hatasına yol açabiliyordu) kaldırıldı, sadece BİZİM sunucumuzun çektiği
            PDF gösteriliyor. "yeni sekme yerine aşağıda açamaz mı" — ayrı sekme yerine aynı sayfada
            <iframe> içinde gömülü açılıyor. */}
        <button
          className="btn-primary"
          type="button"
          onClick={() => setOpenPdfUrl(`/api/aladdin-invoice/pdf?invoiceId=${encodeURIComponent(result.invoiceId)}`)}
        >
          PDF Görüntüle
        </button>
        <PdfViewer url={openPdfUrl} onClose={() => setOpenPdfUrl(null)} />
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        {dateFilterBar}
        <div className="hint">Faturalar taranıyor...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {dateFilterBar}
        <div className="card">
          <div className="hint" style={{ color: "var(--danger)", marginBottom: 8 }}>
            {error}
          </div>
          {/* onClick={loadPreview} DEĞİL — loadPreview artık opsiyonel bir "date" parametresi
              alıyor, doğrudan geçilirse React'ın tıklama olayı (MouseEvent) "date" sanılırdı
              (2026-09-18'de bu değişiklikle eklenen bir riskti, BURADA baştan önlendi). Kullanıcı
              geçmiş bir günü görüntülerken hata alırsa "Tekrar Dene" o günü tekrar denemeli,
              sessizce bugüne dönmemeli. */}
          <button className="btn-secondary" type="button" onClick={() => loadPreview(selectedDate || undefined)}>
            Tekrar Dene
          </button>
        </div>
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
      <div>
        {dateFilterBar}
        <div className="empty-state">
        {message}
        {/* Kullanıcı talebi (2026-09-17): "kesilen faturayı göster" — önceden bu link sadece fatura
            kesme isteğinin tek seferlik ekran cevabında vardı, sayfa yenilenince kayboluyordu. */}
        {preview && preview.existingInvoices.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            {preview.existingInvoices.map((inv) =>
              // invoiceId VARSA sadece PDF butonu yeterli (kullanıcı talebi: "artık Paraşüt'le
              // görüntüle butonuna gerek yok"). invoiceId YOKSA (bu özellikten ÖNCE kesilmiş eski
              // faturalar) PDF gösterilemez — o durumda harici Paraşüt linki FALLBACK olarak
              // kalıyor, aksi halde o eski fatura listede hiç görünmez hale gelirdi (2026-09-17
              // code review'da tespit edildi: "az önce kesilen fatura kaybolmuş gibi görünür").
              inv.invoiceId ? (
                <button
                  key={inv.printUrl}
                  className="btn-primary"
                  type="button"
                  onClick={() => setOpenPdfUrl(`/api/aladdin-invoice/pdf?invoiceId=${encodeURIComponent(inv.invoiceId as string)}`)}
                >
                  {inv.invoiceNo ? `${inv.invoiceNo} — PDF Görüntüle` : "PDF Görüntüle"}
                </button>
              ) : (
                <button
                  key={inv.printUrl}
                  className="btn-secondary"
                  type="button"
                  onClick={() => window.open(inv.printUrl, "_blank", "noopener,noreferrer")}
                >
                  {inv.invoiceNo ? `${inv.invoiceNo} — Paraşüt'te Görüntüle` : "Paraşüt'te Görüntüle"} ↗
                </button>
              ),
            )}
          </div>
        )}
        <PdfViewer url={openPdfUrl} onClose={() => setOpenPdfUrl(null)} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {dateFilterBar}
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
        <button className="btn-secondary" disabled={creating} onClick={() => loadPreview(selectedDate || undefined)}>
          Önizlemeyi Yenile
        </button>
      </div>
    </div>
  );
}
