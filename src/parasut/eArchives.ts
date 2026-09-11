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

// showEArchive'in (PDF durumu) cevabı createEArchive'inkinden FARKLI — PDF henüz GİB tarafında
// hazırlanmadıysa "data" alanı hiç gelmiyor (2026-09-11'de canlıda doğrulandı). Bunu AYRI bir tip
// olarak (data OPSİYONEL) tanımlamak, ileride showEArchive'i doğrudan çağırıp eskisi gibi
// res.data.attributes yazan birinin bunu derleme zamanında fark etmesini sağlıyor — createEArchive
// için hâlâ data her zaman var, o yüzden onun tipi (ParasutEArchiveResponse) değişmedi (2026-09-11'de
// code review'da tespit edildi).
export interface ParasutEArchivePdfResponse {
  data?: ParasutEArchive;
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
  return parasutGet<ParasutEArchivePdfResponse>(`e_archives/${eArchiveId}/pdf`);
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
// için bu link AYRICA fetch edilmeli (2026-09-09, automation-nextjs projesindeki pattern). PDF
// GİB tarafında henüz hazırlanmadıysa Paraşüt bu uç noktada "data" alanı OLMAYAN bir cevap
// dönüyor (2026-09-11'de canlıda doğrulandı) — bu NORMAL/beklenen bir durum, hata değil, o yüzden
// BİLEREK ?. ile null'a düşürülüyor (önceden res.data.attributes doğrudan okunuyordu, bu da bu
// bekleme anında bir TypeError fırlatıp resolveInvoicePdf'in catch'ine düşüyordu — gerçek Paraşüt
// hatalarıyla (geçersiz token, tükenmiş 429 tekrar denemesi vb.) aynı kefeye konmasına yol
// açıyordu, 2026-09-11'de code review'da tespit edildi).
export async function getEArchivePdfUrl(eArchiveId: string): Promise<string | null> {
  const res = await showEArchive(eArchiveId);
  const url = (res?.data?.attributes?.url as string | undefined) ?? null;
  // "data" alanı YOKSA (henüz hazır değil, doğrulanmış normal durum) ya da VARKEN de "url" YOKSA
  // (görülmemiş, olası GERÇEKTEN bozuk bir durum) — ikisi de sessizce null döndürülüyor ama en
  // azından burada iz bırakılıyor; aksi halde her iki durum da hiçbir yerde loglanmadan sonsuza
  // dek "İşleniyor" gösterilebilirdi (2026-09-11'de code review'da tespit edildi).
  if (!url) {
    console.log(
      `[parasut] eArchive ${eArchiveId} için henüz PDF url'i yok (data: ${res?.data ? "var" : "yok"}, attributes.url: ${
        res?.data?.attributes ? "yok/boş" : "attributes de yok"
      }) — tekrar denenecek.`,
    );
  }
  return url;
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
  } catch (err) {
    // Hata öncesi burada sessizce yutuluyordu — bir sorun olduğunda (ör. 2026-09-10'da yaşanan
    // eşzamanlı token isteği hatası) loglarda HİÇBİR iz kalmıyordu, teşhis çok zor oldu. Artık
    // loglanıyor, sonucu (kullanıcıya "İşleniyor" gösterilmesi) değişmiyor.
    console.error(`[parasut] findActiveEArchiveId başarısız (invoice ${invoiceId}):`, err);
    return { status: "processing", archiveExists: false };
  }

  if (!eArchiveId && allowRetry) {
    try {
      const retry = await createEArchive(invoiceId);
      eArchiveId = retry.data.id;
    } catch (err) {
      console.error(`[parasut] createEArchive (retry) başarısız (invoice ${invoiceId}):`, err);
      return { status: "processing", archiveExists: false };
    }
  }

  if (!eArchiveId) return { status: "processing", archiveExists: false };

  try {
    // PDF henüz hazır değilse (GİB tarafında birkaç saniye/dakika sürebiliyor) getEArchivePdfUrl
    // artık ARTIK EXCEPTION FIRLATMIYOR, sadece null dönüyor (bkz. yukarıdaki fonksiyon) — bu
    // yüzden bu catch bloğuna düşen HER ŞEY gerçekten beklenmedik bir hata demektir (geçersiz
    // token, tükenmiş 429 tekrar denemesi, config eksikliği vb.); "normal bekleme" ile "gerçek
    // arıza"yı ayırt etmek için exception tipine bakmaya (önceki yazım) artık gerek yok (2026-09-11'de
    // code review'da tespit edildi — TypeError sniff'i, ileride farklı bir TypeError'ı da yanlışlıkla
    // "normal" sayabilirdi).
    const pdfUrl = await getEArchivePdfUrl(eArchiveId);
    if (!pdfUrl) return { status: "processing", archiveExists: true };
    return { status: "ready", pdfUrl, archiveExists: true };
  } catch (err) {
    console.error(`[parasut] getEArchivePdfUrl başarısız (eArchive ${eArchiveId}, invoice ${invoiceId}):`, err);
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
