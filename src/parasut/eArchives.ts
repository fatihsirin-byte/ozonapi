import { parasutPost, parasutGet } from "./client";
import { prisma } from "../db/prisma";

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

// archiveExists=true → Paraşüt'te bu fatura için bir e-Arşiv kaydı GERÇEKTEN VAR (PDF henüz hazır
// olmasa bile) — bu durumda bir daha ASLA createEArchive çağrılmamalı. archiveExists=false → hiç
// oluşmadı (ya da retry de başarısız oldu), bir dahaki sefere tekrar denenebilir.
export type ResolveInvoicePdfResult =
  | { status: "ready"; pdfUrl: string; archiveExists: true }
  | { status: "processing"; archiveExists: boolean };

// PDF durumunu canlı sorgulayan, hem "Faturayı Aç" butonu hem toplu ZIP indirme tarafından
// kullanılan tek ortak yer (2026-09-09'da code review'da tespit edilen kod tekrarına karşılık
// birleştirildi). KRİTİK: allowRetry SADECE fatura kesilirken e-Arşiv adımı gerçekten başarısız
// olduysa true gönderilmeli — aksi halde Paraşüt/GİB tarafında hâlâ işlemde olan (ama BİZİM
// tarafımızda başarıyla kabul edilmiş) bir e-Arşiv'i "yok" sanıp createEArchive'i tekrar çağırmak,
// aynı fatura için GERÇEK, ikinci bir GİB başvurusu oluşturabilir (2026-09-09'da code review'da
// tespit edildi). Bu fonksiyonun kendisi eşzamanlılığa karşı KORUMASIZ — allowRetry kararını
// atomik olarak veren resolveInvoicePdfForOrder üzerinden çağrılmalı, doğrudan değil.
export async function resolveInvoicePdf(invoiceId: string, allowRetry: boolean): Promise<ResolveInvoicePdfResult> {
  let eArchiveId: string | null;
  try {
    eArchiveId = await findActiveEArchiveId(invoiceId);
  } catch {
    return { status: "processing", archiveExists: false };
  }

  if (!eArchiveId && allowRetry) {
    try {
      const retry = await createEArchive(invoiceId);
      eArchiveId = retry.data.id;
    } catch {
      return { status: "processing", archiveExists: false };
    }
  }

  if (!eArchiveId) return { status: "processing", archiveExists: false };

  try {
    const pdfUrl = await getEArchivePdfUrl(eArchiveId);
    if (!pdfUrl) return { status: "processing", archiveExists: true };
    return { status: "ready", pdfUrl, archiveExists: true };
  } catch {
    return { status: "processing", archiveExists: true };
  }
}

// resolveInvoicePdf'in eşzamanlılığa GÜVENLİ sarmalayıcısı — asıl "Faturayı Aç" butonu ve toplu
// ZIP indirme BUNU çağırmalı. Order.parasutEArchiveFailed=true→false geçişini ATOMİK bir
// updateMany ile "claim" ediyor: aynı anda gelen iki istekten sadece biri true→false geçişini
// yakalayıp retry hakkı alabiliyor (DB bunu garanti ediyor), diğeri allowRetry=false ile devam
// eder — bu, iki sekmede aynı siparişi açmak ya da "Tekrar Kontrol Et"e art arda basmak gibi
// durumlarda GERÇEK bir faturanın iki kez GİB'e gönderilmesini engeller (2026-09-09'da code
// review'da tespit edildi). Retry hak edildiği halde e-Arşiv oluşturulamazsa (archiveExists=false)
// bayrak geri "true"ya çevrilir ki bir dahaki kontrolde tekrar denenebilsin.
export async function resolveInvoicePdfForOrder(postingNumber: string, invoiceId: string): Promise<ResolveInvoicePdfResult> {
  const claim = await prisma.order.updateMany({
    where: { postingNumber, parasutEArchiveFailed: true },
    data: { parasutEArchiveFailed: false },
  });
  const allowRetry = claim.count > 0;

  const result = await resolveInvoicePdf(invoiceId, allowRetry);

  if (allowRetry && !result.archiveExists) {
    await prisma.order.update({ where: { postingNumber }, data: { parasutEArchiveFailed: true } });
  }

  return result;
}
