import { parasutPost, parasutGet } from "./client";

// KRİTİK ADIM (2026-09-09'da /Users/.../automation-nextjs projesindeki çalışan Paraşüt
// entegrasyonuna bakılarak bulundu): sadece POST /sales_invoices ile fatura TASLAK kalıyor —
// resmi e-Arşiv'e dönüşmesi (GİB'e gidip QR/ETTN kazanması) ve KDV istisna kodunun (301, mal
// ihracatı) gerçekten işlenmesi için AYRI bir POST /e_archives isteği gerekiyor. Bizim ilk
// denemelerimizde faturaların "TASLAK" kalmasının ve print/pdf endpoint'lerinin "PrintTemplate
// bulunamadı" vermesinin sebebi tam olarak bu adımın hiç çağrılmamış olmasıydı.
export interface ParasutEArchive {
  id: string;
  type: "e_archives";
  attributes: { url?: string | null; [key: string]: unknown };
}

export interface ParasutEArchiveResponse {
  data: ParasutEArchive;
}

export function createEArchive(salesInvoiceId: string, vatExemptionReasonCode = "301") {
  return parasutPost<ParasutEArchiveResponse>("e_archives", {
    data: {
      type: "e_archives",
      relationships: {
        sales_invoice: { data: { id: salesInvoiceId, type: "sales_invoices" } },
      },
      attributes: {
        vat_exemption_reason_code: vatExemptionReasonCode,
      },
    },
  });
}

export function showEArchive(eArchiveId: string) {
  return parasutGet<ParasutEArchiveResponse>(`e_archives/${eArchiveId}/pdf`);
}

// Bir sales_invoice'a bağlı e-Arşiv'in id'sini bulur (varsa) — include=active_e_document ile.
export async function findActiveEArchiveId(salesInvoiceId: string): Promise<string | null> {
  const res = await parasutGet<{ included?: Array<{ id: string; type: string }> }>(
    `sales_invoices/${salesInvoiceId}?include=active_e_document`,
  );
  const eDoc = res.included?.find((i) => i.type === "e_archives");
  return eDoc?.id ?? null;
}

// PDF'in kendisi değil, S3'teki geçici (presigned) indirme linkini döner — asıl dosyayı çekmek
// için bu link AYRICA fetch edilmeli (2026-09-09, automation-nextjs projesindeki pattern).
export async function getEArchivePdfUrl(eArchiveId: string): Promise<string | null> {
  const res = await showEArchive(eArchiveId);
  return (res.data.attributes.url as string | undefined) ?? null;
}
