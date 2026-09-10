"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  postingNumber: string;
  initialInvoiceNo: string | null;
  initialPrintUrl: string | null;
  // true ise bu faturanın PDF'i DAHA ÖNCE en az bir kere başarıyla doğrulanmış demektir (bkz.
  // Order.parasutInvoiceNoConfirmed) — bu durumda sayfa her açıldığında 10 saniyede bir tekrar
  // tekrar Paraşüt'e sormaya gerek yok, TEK bir kontrol yeterli. Aksi halde (henüz hiç
  // doğrulanmamış, yeni kesilmiş faturalar) aşağıdaki otomatik yeniden deneme döngüsü çalışır.
  initialConfirmed?: boolean;
  // true ise PDF diskimize kalıcı olarak indirilmiş (bkz. Order.parasutInvoicePdfCached) — bu
  // durumda "Faturayı Aç" doğrudan bizim sunucumuzdaki dosyaya gider, Paraşüt panelindeki
  // (harici, ayrı giriş gerektirebilen) linke değil.
  initialPdfCached?: boolean;
}

type PdfStatus = "checking" | "ready" | "processing" | "error" | "stalled";

const AUTO_CHECK_INTERVAL_MS = 10_000;
// Sınırsız otomatik yeniden deneme, Paraşüt'e (rate limit'e açık, bkz. src/parasut/client.ts) ve
// e-Arşiv yeniden deneme mekanizmasına (bkz. src/parasut/eArchives.ts) sürekli yük bindirir —
// 2 dakika (12 deneme) sonra durup kullanıcıya elle "Tekrar Dene" seçeneği sunuluyor; bu hem
// kalıcı bir sorunda kullanıcıya haber verilmesini sağlıyor hem gereksiz sürekli isteği kesiyor
// (2026-09-10'da code review'da tespit edildi).
const MAX_AUTO_CHECKS = 12;

// Paraşüt'te GERÇEK bir satış faturası oluşturur — geri alınamaz, bu yüzden tıklamadan önce
// onay isteniyor. Kesildikten sonra buton "Faturayı Aç" linkine dönüşür (2026-09-09, kullanıcı
// talebi). Fatura kesilir kesilmez Paraşüt'ün e-Arşiv'i GİB'e gönderip resmileştirmesi
// (panelde "GÖNDERİLİYOR" durumu) birkaç saniye/dakika sürebiliyor — bu esnada PDF linki henüz
// hazır olmuyor (2026-09-09'da canlıda "ActiveRecord::RecordNotFound" hatasıyla tespit edildi).
// Bu yüzden durumu canlı sorguluyoruz; hazır olana kadar buton devre dışı "İşleniyor..." gösterir
// ve arkada TEK bir interval ile 10 saniyede bir kendiliğinden tekrar kontrol eder — geçici bir
// ağ hatası (pdfStatus "error" olsa da) kontrolü kalıcı olarak DURDURMAZ, MAX_AUTO_CHECKS'e kadar
// devam eder (2026-09-10, kullanıcı talebi + code review'da "hata sonrası otomatik kontrol tamamen
// duruyor" bulgusuna karşılık; tekrar deneme SADECE gerçekten başarısız olduysa yeni e-Arşiv
// başvurusu yapar, bkz. src/parasut/eArchives.ts — burası sadece PDF durumunu okur).
export function ParasutInvoiceButton({ postingNumber, initialInvoiceNo, initialPrintUrl, initialConfirmed, initialPdfCached }: Props) {
  const router = useRouter();
  // 2026-09-10'da canlıda tespit edildi: onlarca fatura kesilmiş siparişin bulunduğu bir sayfa
  // açıldığında HEPSİ aynı anda 10 saniyede bir kontrol başlatıyordu — Paraşüt'e giden eşzamanlı
  // istek yığını (özellikle token isteğinde, bkz. src/parasut/client.ts) bazı kontrollerin sessizce
  // başarısız olmasına, butonların sonsuza dek "İşleniyor"/"2 dakikadır hazır değil" durumunda
  // takılı kalmasına yol açtı — halbuki fatura günler önce sorunsuz kesilmişti. Zaten bir kere
  // doğrulanmış faturalarda artık TEKRARLAYAN otomatik kontrol yapılmıyor, sadece tek seferlik.
  const retryable = !initialConfirmed;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState(initialInvoiceNo);
  const [panelUrl, setPanelUrl] = useState(initialPrintUrl ? initialPrintUrl.replace(/\/print$/, "") : null);
  const [hasInvoice, setHasInvoice] = useState(Boolean(initialPrintUrl || initialInvoiceNo));
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>("checking");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const statusRef = useRef<PdfStatus>("checking");
  const attemptsRef = useRef(0);
  // Sunucu tarafında bir kontrol, sırasıyla birkaç Paraşüt isteğine kadar zincirleyebiliyor
  // (fatura no doğrulama + e-Arşiv arama/oluşturma + PDF linki) — her biri kendi yeniden deneme
  // bütçesine sahip, hız sınırı krizinde tek bir kontrol epey uzun sürebilir (bkz. src/parasut/client.ts
  // MAX_BACKOFF_MS yorumu). Bu yüzden önceki kontrol hâlâ cevap beklerken 10 saniyelik interval
  // yeni bir tane daha BAŞLATMASIN diye korunuyor — aksi halde hız sınırı krizi sırasında tam da
  // onu kötüleştirecek şekilde istekler üst üste yığılırdı (2026-09-10'da code review'da tespit edildi).
  const isCheckingRef = useRef(false);
  // "Tekrar Dene" tıklanınca hem elle bir kontrol yapılsın hem de aşağıdaki otomatik kontrol
  // interval'ı SIFIRDAN kurulsun diye — sadece checkPdfStatus() çağırmak yetmiyordu, çünkü
  // interval yalnızca [hasInvoice] değiştiğinde kuruluyordu ve MAX_AUTO_CHECKS'e ulaşıp bir kez
  // duran interval bir daha asla yeniden başlamıyordu (2026-09-10'da code review'da tespit edildi
  // — kullanıcı "stalled" durumundan sonra sonsuza dek devre dışı bir butonda kalabiliyordu).
  const [retryTick, setRetryTick] = useState(0);

  async function checkPdfStatus() {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    setPdfStatus((prev) => (prev === "ready" ? prev : "checking"));
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/parasut-invoice/pdf`);
      const data = await res.json();
      if (data.status === "ready" && data.pdfUrl) {
        setPdfUrl(data.pdfUrl);
        // Sunucu bu sırada gerçek (GİB'e göre yeniden atanmış) fatura numarasını da okuyup
        // döndürebiliyor — yoksa DB'ye yazılan doğru numara sayfa yenilenene kadar görünmezdi
        // (2026-09-10'da code review'da tespit edildi).
        if (data.invoiceNo) setInvoiceNo(data.invoiceNo);
        setPdfStatus("ready");
      } else {
        setPdfStatus("processing");
      }
    } catch {
      setPdfStatus("error");
    } finally {
      isCheckingRef.current = false;
    }
  }

  function manualRetry() {
    setRetryTick((n) => n + 1);
  }

  useEffect(() => {
    statusRef.current = pdfStatus;
  }, [pdfStatus]);

  useEffect(() => {
    // Zaten doğrulanmış (retryable=false) faturalarda burada HİÇ Paraşüt isteği atılmıyor —
    // panel linki (printUrl) fatura kesilirken zaten kalıcı olarak kaydedilmişti, sayfa her
    // yenilendiğinde tekrar sormaya gerek yok (2026-09-10, kullanıcı talebi: "bi kere link
    // geldikten sonra sakla, her yenilediğimizde kontrol etmesin"). Aşağıdaki render'da bu durumda
    // doğrudan panelUrl'e giden bir "Faturayı Aç" gösteriliyor.
    if (!hasInvoice || !retryable) return;
    attemptsRef.current = 0;
    checkPdfStatus();
    const interval = setInterval(() => {
      if (statusRef.current === "ready") {
        clearInterval(interval);
        return;
      }
      attemptsRef.current += 1;
      if (attemptsRef.current >= MAX_AUTO_CHECKS) {
        clearInterval(interval);
        setPdfStatus("stalled");
        return;
      }
      checkPdfStatus();
    }, AUTO_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInvoice, retryable, retryTick]);

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

  // Zaten doğrulanmış faturalarda HİÇ canlı kontrol yapılmadan (yukarıdaki effect), doğrudan
  // "Faturayı Aç" gösteriliyor — bu faturanın PDF'i kesin var, tekrar sormaya gerek yok. PDF
  // diske önbelleğe alınmışsa (initialPdfCached) doğrudan kendi sunucumuzdaki dosyaya, değilse
  // yedek olarak Paraşüt panel linkine gidiyor (2026-09-10, kullanıcı talebi).
  const cachedPdfHref = `/api/orders/${encodeURIComponent(postingNumber)}/parasut-invoice/pdf-file`;
  if (hasInvoice && !retryable) {
    const href = initialPdfCached ? cachedPdfHref : panelUrl;
    return href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        <button className="btn-secondary">Faturayı Aç {invoiceNo ? `(${invoiceNo})` : ""} ↗</button>
      </a>
    ) : (
      <span className="hint">Fatura kesildi{invoiceNo ? ` (${invoiceNo})` : ""}</span>
    );
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
            <button className="btn-secondary" onClick={manualRetry}>Tekrar Dene</button>
          </div>
        )}
        {pdfStatus === "stalled" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="hint" style={{ color: "var(--danger)" }}>2 dakikadır hazır değil — Paraşüt panelinden kontrol edin</span>
            <button className="btn-secondary" onClick={manualRetry}>Tekrar Dene</button>
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
