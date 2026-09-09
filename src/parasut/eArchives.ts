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

export type ResolveInvoicePdfResult =
  | { status: "ready"; pdfUrl: string; recoveredFromFailure: boolean }
  | { status: "processing" };

// PDF durumunu canlı sorgulayan, hem "Faturayı Aç" butonu hem toplu ZIP indirme tarafından
// kullanılan tek ortak yer (2026-09-09'da code review'da tespit edilen kod tekrarına karşılık
// birleştirildi). KRİTİK: allowRetry SADECE fatura kesilirken e-Arşiv adımı gerçekten başarısız
// olduysa (Order.parasutEArchiveFailed) true gönderilmeli — aksi halde Paraşüt/GİB tarafında hâlâ
// işlemde olan (ama BİZİM tarafımızda başarıyla kabul edilmiş) bir e-Arşiv'i "yok" sanıp
// createEArchive'i tekrar çağırmak, aynı fatura için GERÇEK, ikinci bir GİB başvurusu oluşturabilir
// (2026-09-09'da code review'da tespit edildi — bu proje için özellikle riskli, gerçek belgeler
// silinemiyor). allowRetry false iken sadece "processing" döner, kullanıcı biraz sonra tekrar dener.
export async function resolveInvoicePdf(invoiceId: string, allowRetry: boolean): Promise<ResolveInvoicePdfResult> {
  let eArchiveId: string | null;
  try {
    eArchiveId = await findActiveEArchiveId(invoiceId);
  } catch {
    return { status: "processing" };
  }

  let recoveredFromFailure = false;
  if (!eArchiveId && allowRetry) {
    try {
      const retry = await createEArchive(invoiceId);
      eArchiveId = retry.data.id;
      recoveredFromFailure = true;
    } catch {
      return { status: "processing" };
    }
  }

  if (!eArchiveId) return { status: "processing" };

  try {
    const pdfUrl = await getEArchivePdfUrl(eArchiveId);
    if (!pdfUrl) return { status: "processing" };
    return { status: "ready", pdfUrl, recoveredFromFailure };
  } catch {
    return { status: "processing" };
  }
}
