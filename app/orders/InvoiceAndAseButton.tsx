"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isHsCodeError } from "@/ase/constants";

interface Props {
  postingNumber: string;
  initialInvoiceNo: string | null;
  initialPrintUrl: string | null;
  initialInvoiceConfirmed: boolean;
  initialPdfCached: boolean;
  initialAseSentAt: string | null;
  initialAseSuccess: boolean | null;
  initialAseMessage: string | null;
}

interface OrderHsCodeInfo {
  offerId: string;
  productName: string;
  hsCode: string | null;
}

interface AseShipmentResponse {
  sentAt: string | null;
  success: boolean | null;
  message: string | null;
  errorCode: string | null;
  items: OrderHsCodeInfo[];
}

type PdfStatus = "idle" | "checking" | "ready" | "processing" | "error" | "stalled";

const AUTO_CHECK_INTERVAL_MS = 10_000;
// bkz. eski ParasutInvoiceButton'daki aynı sabit — sınırsız otomatik yeniden deneme Paraşüt'e
// sürekli yük bindirir, 2 dakika sonra durup elle "Tekrar Dene" sunuluyor.
const MAX_AUTO_CHECKS = 12;

// "Fatura Kes" + "ASE'ye Gönder" TEK bir akış olarak birleştirildi (2026-09-16, kullanıcı talebi:
// "paraşüt fatura yazdır ve ase gönderin tek butonla bekleyerek yapılması, retry lar olması,
// statü poll göstermesi, hata verirse uyarması"). Önceden İKİ AYRI buton vardı
// (ParasutInvoiceButton + AseShipmentButton) — kullanıcı fatura kesilip Paraşüt'ün e-Arşiv'i
// GİB'e gönderip onaylamasını (birkaç saniye/dakika) bekleyip AYRICA "ASE'ye Gönder"e basmak
// zorundaydı. Artık: fatura kesilir, arka planda GİB onayı beklenir (aynı polling mantığı),
// onaylanır onaylanmaz OTOMATİK olarak ASE'ye gönderilir.
//
// Bu bileşen, ayrı ayrı birçok code-review turundan geçmiş iki eski bileşenin (artık silinen
// ParasutInvoiceButton.tsx + AseShipmentButton.tsx) yerini alıyor — oradaki kazanımlar (tek
// uçuşta tek istek — isCheckingRef, MAX_AUTO_CHECKS sonrası elle "Tekrar Dene", HS kod
// düzelt-ve-tekrar-dene popup'ı, gerçek fatura onay diyaloğu, router.refresh() zamanlaması, ASE
// yanıtını STATE değil DOĞRUDAN fetch sonucunu okuyarak işleme — React state batching'in eski
// değeri okumasını önlemek için) BİREBİR korunuyor.
export function InvoiceAndAseButton({
  postingNumber,
  initialInvoiceNo,
  initialPrintUrl,
  initialInvoiceConfirmed,
  initialPdfCached,
  initialAseSentAt,
  initialAseSuccess,
  initialAseMessage,
}: Props) {
  const router = useRouter();

  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState(initialInvoiceNo);
  const [panelUrl, setPanelUrl] = useState(initialPrintUrl ? initialPrintUrl.replace(/\/print$/, "") : null);
  const [hasInvoice, setHasInvoice] = useState(Boolean(initialPrintUrl || initialInvoiceNo));
  const [invoiceConfirmed, setInvoiceConfirmed] = useState(initialInvoiceConfirmed);
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>(initialInvoiceConfirmed ? "ready" : "idle");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfCached] = useState(initialPdfCached);

  const [aseSentAt, setAseSentAt] = useState(initialAseSentAt);
  const [aseSuccess, setAseSuccess] = useState(initialAseSuccess);
  const [aseMessage, setAseMessage] = useState(initialAseMessage);
  const [aseSending, setAseSending] = useState(false);

  const [hsPopupOpen, setHsPopupOpen] = useState(false);
  const [hsInputs, setHsInputs] = useState<Record<string, string>>({});
  const [hsProductNames, setHsProductNames] = useState<Record<string, string>>({});
  const [hsSaving, setHsSaving] = useState(false);
  const [hsPopupError, setHsPopupError] = useState<string | null>(null);

  const statusRef = useRef(pdfStatus);
  const attemptsRef = useRef(0);
  const isCheckingRef = useRef(false);
  const [retryTick, setRetryTick] = useState(0);
  // invoiceConfirmed false->true GEÇİŞİNDE (ya da mount anında zaten confirmed ise) ASE'yi TAM
  // OLARAK BİR KEZ otomatik tetiklemek için — aksi halde AYNI bileşen örneğinde her yeniden
  // render'da ya da her polling turunda tekrar tekrar GERÇEK bir gönderim denenebilirdi. NOT: bu
  // ref SADECE bu bileşen örneği için geçerli — kullanıcı gönderim daha sonuçlanmadan sayfadan
  // çıkıp geri dönerse (yeni bir bileşen örneği, initialAseSentAt/Success DB'de hâlâ null) ikinci
  // bir istek atılabilir. Asıl (ve tek güvenilir) mükerrer gönderim koruması İSTEMCİDE değil,
  // src/ase/orderShipment.ts'teki inFlight kilidi + "zaten başarılıysa bir daha gönderme"
  // kontrolündedir — bu ref sadece AYNI oturumda gereksiz tekrar isteği atılmasını azaltan bir
  // iyileştirme (2026-09-16 code review'da "bu ref tek başına yeterli değil" tespiti üzerine not
  // eklendi, davranış zaten arka uçtaki koruma sayesinde güvenliydi).
  const aseAutoTriggeredRef = useRef(initialAseSentAt != null || initialAseSuccess != null);

  useEffect(() => {
    statusRef.current = pdfStatus;
  }, [pdfStatus]);

  // ASE'ye gönderim — sonucu HER ZAMAN bu fonksiyonun döndürdüğü `data`dan okuyoruz, state'ten
  // DEĞİL (React state güncellemeleri eşzamanlı garanti değil; eski AseShipmentButton'da bu
  // ayrım bilerek yapılmıştı, bkz. handleHsRetry'nin data.success kontrolü).
  async function runAseStep(): Promise<AseShipmentResponse | null> {
    setAseSending(true);
    let data: AseShipmentResponse | null = null;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/ase-shipment`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setAseSuccess(false);
        setAseMessage(body.error ?? "Gönderilemedi");
        setAseSentAt(new Date().toISOString());
        return null;
      }
      data = body as AseShipmentResponse;
    } catch (err) {
      setAseSuccess(false);
      setAseMessage(err instanceof Error ? err.message : "Bilinmeyen hata");
      setAseSentAt(new Date().toISOString());
      return null;
    } finally {
      setAseSending(false);
    }

    setAseSentAt(data.sentAt);
    setAseSuccess(data.success);
    setAseMessage(data.message);
    // Sayfadaki EtgbInfo bileşeni ASE durumunu sunucudan (page.tsx) PROP olarak alıyor — sonuç ne
    // olursa olsun tazeleniyor (bkz. eski AseShipmentButton'daki aynı gerekçe).
    router.refresh();
    if (data.success) {
      setHsPopupOpen(false);
    } else if (isHsCodeError(data.errorCode, data.message)) {
      const inputs: Record<string, string> = {};
      const names: Record<string, string> = {};
      for (const item of data.items) {
        inputs[item.offerId] = item.hsCode ?? "";
        names[item.offerId] = item.productName;
      }
      setHsInputs(inputs);
      setHsProductNames(names);
      setHsPopupError(data.message);
      setHsPopupOpen(true);
    } else {
      // HS kodu sorun değil ama başka bir hatayla başarısız oldu — açık bir HS popup'ı varsa (ör.
      // önceki bir denemeden) artık işlevsiz, normal hata gösterimine dönülüyor.
      setHsPopupOpen(false);
    }
    return data;
  }

  async function checkPdfStatus() {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    setPdfStatus((prev) => (prev === "ready" ? prev : "checking"));
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/parasut-invoice/pdf`);
      const data = await res.json();
      if (data.status === "ready" && data.pdfUrl) {
        setPdfUrl(data.pdfUrl);
        if (data.invoiceNo) setInvoiceNo(data.invoiceNo);
        const justConfirmed = statusRef.current !== "ready";
        if (justConfirmed) {
          setInvoiceConfirmed(true);
          router.refresh();
        }
        setPdfStatus("ready");
        if (justConfirmed && !aseAutoTriggeredRef.current) {
          aseAutoTriggeredRef.current = true;
          await runAseStep();
        }
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
    if (!hasInvoice || invoiceConfirmed) return;
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
  }, [hasInvoice, invoiceConfirmed, retryTick]);

  // Sayfa açıldığında fatura ZATEN onaylanmış ama ASE hiç denenmemişse (ör. bu birleşik akıştan
  // önce fatura kesilmiş eski bir sipariş) yukarıdaki polling effect'i hiç çalışmaz (invoiceConfirmed
  // baştan true) — bu yüzden mount anında AYRICA kontrol ediyoruz.
  useEffect(() => {
    if (invoiceConfirmed && !aseAutoTriggeredRef.current) {
      aseAutoTriggeredRef.current = true;
      runAseStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!confirm("Paraşüt'te bu sipariş için GERÇEK bir satış faturası kesilecek. Onaylıyor musunuz?")) return;
    setInvoiceLoading(true);
    setInvoiceError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/parasut-invoice`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setInvoiceError(data.error ?? "Fatura kesilemedi");
        return;
      }
      setInvoiceNo(data.invoiceNo);
      setPanelUrl(data.printUrl ? String(data.printUrl).replace(/\/print$/, "") : null);
      setHasInvoice(true);
      router.refresh();
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setInvoiceLoading(false);
    }
  }

  async function handleHsRetry() {
    setHsSaving(true);
    setHsPopupError(null);
    try {
      // Önce her kalemin HS kodunu ÜRÜNE kalıcı olarak kaydet (Product.gtipOverride).
      await Promise.all(
        Object.entries(hsInputs).map(([offerId, hsCode]) =>
          fetch(`/api/products/${encodeURIComponent(offerId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gtipOverride: hsCode.trim() || null }),
          }),
        ),
      );
      const data = await runAseStep();
      if (data && !data.success && isHsCodeError(data.errorCode, data.message)) {
        // Hâlâ hatalı — popup açık kalır (runAseStep zaten güncel hatayı/inputları yazdı).
      }
    } catch (err) {
      setHsPopupError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setHsSaving(false);
    }
  }

  function renderInvoiceLink() {
    const cachedPdfHref = `/api/orders/${encodeURIComponent(postingNumber)}/parasut-invoice/pdf-file`;
    const href = pdfCached ? cachedPdfHref : (pdfUrl ?? panelUrl);
    if (!href) return null;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        <button className="btn-secondary" type="button">
          Faturayı Aç {invoiceNo ? `(${invoiceNo})` : ""} ↗
        </button>
      </a>
    );
  }

  const hsPopup = hsPopupOpen && (
    <div className="modal-overlay" onClick={() => setHsPopupOpen(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>HS (GTİP) kodu düzeltilmeli</h3>
        <p className="hint">
          {hsPopupError ?? "HS kodu boş ya da hatalı."} Lütfen aşağıdaki ürünler için doğru GTİP kodunu girip
          tekrar deneyin.
        </p>
        {Object.keys(hsInputs).map((offerId) => (
          <div key={offerId} className="field">
            <label>{hsProductNames[offerId] ?? offerId}</label>
            <input
              type="text"
              value={hsInputs[offerId]}
              onChange={(e) => setHsInputs((prev) => ({ ...prev, [offerId]: e.target.value }))}
              placeholder="Örn. 330499009000"
            />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" onClick={() => setHsPopupOpen(false)} disabled={hsSaving}>
            Kapat
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleHsRetry}
            disabled={hsSaving || Object.values(hsInputs).some((v) => !v.trim())}
          >
            {hsSaving ? "Kaydediliyor ve deneniyor..." : "Kaydet ve Tekrar Dene"}
          </button>
        </div>
      </div>
    </div>
  );

  // 1) Tamamlandı — hem fatura hem ASE gönderimi başarılı.
  if (aseSuccess === true) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
        {renderInvoiceLink()}
        <span className="hint" style={{ color: "var(--success)" }}>
          ASE&apos;ye gönderildi ✓{aseSentAt ? ` (${new Date(aseSentAt).toLocaleString("tr-TR")})` : ""}
        </span>
      </div>
    );
  }

  // 2) Henüz fatura kesilmemiş.
  if (!hasInvoice) {
    return (
      <div>
        <button className="btn-primary" disabled={invoiceLoading} onClick={handleCreate}>
          {invoiceLoading ? "Kesiliyor..." : "Fatura Kes + ASE'ye Gönder"}
        </button>
        {invoiceError && (
          <div className="hint" style={{ color: "var(--danger)", marginTop: 4 }}>
            {invoiceError}
          </div>
        )}
      </div>
    );
  }

  // 3) Fatura kesildi ama Paraşüt'ün e-Arşiv/GİB onayı henüz gelmedi.
  if (!invoiceConfirmed) {
    return (
      <div>
        {pdfStatus === "checking" && (
          <button className="btn-secondary" disabled>
            Fatura onaylanıyor...
          </button>
        )}
        {pdfStatus === "processing" && (
          <button className="btn-secondary" disabled>
            İşleniyor... (birkaç dakika sürebilir)
          </button>
        )}
        {pdfStatus === "error" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="hint" style={{ color: "var(--danger)" }}>
              Durum kontrol edilemedi
            </span>
            <button className="btn-secondary" onClick={manualRetry}>
              Tekrar Dene
            </button>
          </div>
        )}
        {pdfStatus === "stalled" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="hint" style={{ color: "var(--danger)" }}>
              2 dakikadır hazır değil — Paraşüt panelinden kontrol edin
            </span>
            <button className="btn-secondary" onClick={manualRetry}>
              Tekrar Dene
            </button>
          </div>
        )}
        {panelUrl && (
          <div style={{ marginTop: 4 }}>
            <a href={panelUrl} target="_blank" rel="noopener noreferrer" className="hint">
              Paraşüt panelinde görüntüle ↗
            </a>
          </div>
        )}
      </div>
    );
  }

  // 4) Fatura onaylandı — ASE adımı sürüyor / bekliyor / başarısız oldu.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      {renderInvoiceLink()}
      {aseSending && <span className="hint">ASE&apos;ye gönderiliyor...</span>}
      {!aseSending && aseSuccess === false && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="hint" style={{ color: "var(--danger)" }}>
            {aseMessage ?? "ASE gönderimi başarısız"}
          </span>
          <button className="btn-secondary" onClick={() => runAseStep()}>
            Tekrar Dene
          </button>
        </div>
      )}
      {!aseSending && aseSuccess == null && <span className="hint">ASE&apos;ye gönderim bekleniyor...</span>}
      {hsPopup}
    </div>
  );
}
