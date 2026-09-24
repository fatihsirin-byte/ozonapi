"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBulkShip } from "./BulkShipContext";
import { BulkShipWizard } from "./BulkShipWizard";

interface BulkInvoiceAseResult {
  postingNumber: string;
  invoiceSuccess: boolean;
  invoiceError: string | null;
  aseSuccess: boolean | null;
}

// Checkbox artık HER durumdaki siparişte çıkıyor (2026-09-23, kullanıcı talebi) — ama her toplu
// işlem her durumla uyumlu değil: paketleme SADECE "awaiting_packaging" + kilitsiz, etiket SADECE
// "awaiting_deliver" (bkz. label/route.ts, Ozon'un kendi kısıtı). Kullanıcının seçtiği tüm
// siparişleri körlemesine göndermek yerine, burada UYGUN olanlar AYRIŞTIRILIP butonun yanında kaç
// tanesinin işleneceği/atlanacağı gösteriliyor — Fatura+ASE'nin ise durum kısıtı yok
// (createInvoiceForOzonOrder zaten idempotent, sipariş faturalıysa yeniden kesmiyor).
export function BulkShipBar() {
  const router = useRouter();
  const { selected, clear } = useBulkShip();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [labelLoading, setLabelLoading] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceResults, setInvoiceResults] = useState<BulkInvoiceAseResult[] | null>(null);

  if (selected.size === 0 && !wizardOpen) return null;

  const entries = [...selected.values()];
  const warnedCount = entries.filter((e) => e.weightWarning).length;
  const shippableEntries = entries.filter((e) => e.status === "awaiting_packaging" && !e.locked);
  const labelableEntries = entries.filter((e) => e.status === "awaiting_deliver");

  function finish() {
    setWizardOpen(false);
    clear();
    router.refresh();
  }

  async function handleBulkLabels() {
    setLabelLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/labels/bulk-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingNumbers: labelableEntries.map((e) => e.postingNumber) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Etiketler indirilemedi");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `etiketler-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLabelLoading(false);
    }
  }

  async function handleBulkInvoiceAse() {
    // ACİL DÜZELTME (2026-09-24, kullanıcı bulgusu): henüz "Toplanmamış"/kargoya verilmemiş
    // siparişler faturalanınca ASE bunları asla kabul etmiyor (Ozon iletene kadar, bkz.
    // InvoiceAndAseButton.tsx'teki aynı uyarı). Tekil butondaki uyarıyla AYNI gerekçeyle burada da
    // ekleniyor — akış engellenmiyor, sadece bilgilendiriliyor.
    const notYetPacked = entries.filter((e) => e.status === "awaiting_packaging").length;
    const earlyWarning =
      notYetPacked > 0
        ? `\n\nUYARI: Seçilenlerden ${notYetPacked} tanesi henüz kargoya verilmedi (Paketleme Bekliyor) — Ozon paketi ASE'ye iletene kadar ASE gönderimi otomatik olarak bekleyecek.`
        : "";
    if (!confirm(`${entries.length} sipariş için Paraşüt'te GERÇEK satış faturaları kesilecek. Onaylıyor musunuz?${earlyWarning}`)) return;
    setInvoiceLoading(true);
    setError(null);
    setInvoiceResults(null);
    try {
      const res = await fetch("/api/orders/bulk-invoice-ase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingNumbers: entries.map((e) => e.postingNumber) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Toplu fatura kesilemedi");
        return;
      }
      setInvoiceResults(data.results);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setInvoiceLoading(false);
    }
  }

  const invoiceSuccessCount = invoiceResults?.filter((r) => r.invoiceSuccess).length ?? 0;

  return (
    <>
      <div
        className="card"
        style={{
          marginBottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          position: "sticky",
          top: 8,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span>
            <strong>{selected.size}</strong> sipariş seçildi
            {warnedCount > 0 && (
              <span className="hint" style={{ color: "var(--danger)", marginLeft: 6 }}>
                ({warnedCount} tanesi 500g uyarılı)
              </span>
            )}
          </span>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setWizardOpen(true)}
            disabled={shippableEntries.length === 0}
            title={shippableEntries.length === 0 ? "Seçili siparişlerin hiçbiri paketlenmeyi bekleyen durumda değil" : undefined}
          >
            Toplu Paketle {shippableEntries.length > 0 && `(${shippableEntries.length})`}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleBulkLabels}
            disabled={labelLoading || labelableEntries.length === 0}
            title={labelableEntries.length === 0 ? "Seçili siparişlerin hiçbiri kargoya hazır (etiket alınabilir) durumda değil" : undefined}
          >
            {labelLoading ? "Hazırlanıyor..." : `Toplu Etiket İndir ${labelableEntries.length > 0 ? `(${labelableEntries.length})` : ""}`}
          </button>
          <button type="button" className="btn-primary" onClick={handleBulkInvoiceAse} disabled={invoiceLoading}>
            {invoiceLoading ? "Kesiliyor..." : `Toplu Fatura + ASE (${entries.length})`}
          </button>
          <button type="button" className="btn-secondary" onClick={clear}>
            Seçimi Temizle
          </button>
        </div>
        {error && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
        {invoiceResults && (
          <div className="hint">
            {invoiceSuccessCount}/{invoiceResults.length} fatura kesildi.
            {invoiceResults
              .filter((r) => !r.invoiceSuccess)
              .map((r) => (
                <div key={r.postingNumber} style={{ color: "var(--danger)" }}>
                  {r.postingNumber}: {r.invoiceError}
                </div>
              ))}
          </div>
        )}
      </div>
      {wizardOpen && shippableEntries.length > 0 && <BulkShipWizard entries={shippableEntries} onFinish={finish} />}
    </>
  );
}
