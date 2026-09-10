import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/prisma";
import { resolveInvoicePdfForOrder } from "@/parasut/eArchives";
import { showSalesInvoice } from "@/parasut/invoices";
import { INVOICE_CLAIM_SENTINEL } from "@/parasut/orderInvoice";
import { cacheInvoicePdfIfMissing } from "@/parasut/pdfCache";

// Fatura kesildikten sonra Paraşüt'ün e-Arşiv'i GİB'e gönderip resmileştirmesi (Paraşüt panelinde
// "GÖNDERİLİYOR" durumu) birkaç saniye/dakika sürebiliyor — bu esnada bizim tahmini bastığımız
// print linki "ActiveRecord::RecordNotFound" veriyordu (2026-09-09'da canlıda tespit edildi).
// Bu uç, durumu HER İSTEKTE Paraşüt'ten canlı sorgulayıp JSON döner (yönlendirme YAPMIYOR —
// fetch'in "manual redirect" modu tarayıcıda hedef adresi ön yüze göstermiyor, bu yüzden ön yüz
// hazır olduğunda pdfUrl'i doğrudan link olarak kullanıyor). Yeniden e-Arşiv deneme (self-heal),
// SADECE fatura kesilirken bu adım gerçekten başarısız kaldıysa (parasutEArchiveFailed) yapılır —
// aksi halde Paraşüt/GİB tarafında hâlâ işlemde olan bir e-Arşiv'i "yok" sanıp tekrar denemek,
// aynı fatura için GERÇEK, ikinci bir GİB başvurusu oluşturabilir (bkz. src/parasut/eArchives.ts).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const decodedPostingNumber = decodeURIComponent(postingNumber);
  const order = await prisma.order.findUnique({
    where: { postingNumber: decodedPostingNumber },
    select: { parasutInvoiceId: true, parasutInvoiceNoConfirmed: true },
  });

  if (!order?.parasutInvoiceId || order.parasutInvoiceId === INVOICE_CLAIM_SENTINEL) {
    return NextResponse.json({ status: "not_invoiced" }, { status: 404 });
  }

  const result = await resolveInvoicePdfForOrder(decodedPostingNumber, order.parasutInvoiceId);

  if (result.status === "processing") {
    return NextResponse.json({ status: "processing" }, { status: 202 });
  }

  // PDF ilk kez "hazır" göründüğü an, diske kalıcı olarak kaydediliyor (2026-09-10, kullanıcı
  // talebi) — bundan sonra ne bu buton ne toplu ZIP indirme bu sipariş için bir daha Paraşüt'e
  // sormak zorunda kalmıyor (bkz. src/parasut/pdfCache.ts). İndirme başarısız olursa (ör. geçici
  // ağ hatası) fatura/PDF linkinin kendisi hâlâ çalışır — sadece bir sonraki "ready" kontrolünde
  // tekrar denenir, bu yüzden hata burada yutuluyor.
  try {
    await cacheInvoicePdfIfMissing(decodedPostingNumber, result.pdfUrl);
  } catch (err) {
    console.error(`[parasut] PDF önbelleğe alınamadı (posting ${decodedPostingNumber}):`, err);
  }

  // PDF'in gerçekten hazır olması, e-Arşiv'in GİB tarafında tam işlendiğinin en güvenilir işareti
  // — gerçek (GİB'e kayıtlı seriye göre yeniden atanmış) fatura numarasını burada okuyup
  // kaydediyoruz. Fatura kesilir kesilmez okumak (eski kod) bayat/geçici bir değer dönebilirdi,
  // çünkü GİB'in yeniden numaralandırması anında olmuyor (2026-09-10'da code review'da tespit
  // edildi) — bkz. src/parasut/orderInvoice.ts. SÜREYE DAYALI bir pencere (ör. "ilk 30 dakika")
  // KULLANILMIYOR — GİB o gün yavaşsa numara kalıcı olarak yanlış kalabilirdi (aynı incelemede
  // tespit edildi). Bunun yerine parasutInvoiceNoConfirmed true OLANA KADAR her "ready" kontrolünde
  // tekrar denenir; true olduktan sonra (gerçek numara elde edildiğinde) bir daha denenmez — aylar
  // önce kesilmiş, numarası çoktan netleşmiş faturalar için gereksiz Paraşüt isteği atılmaz.
  let invoiceNo: string | null = null;
  if (!order.parasutInvoiceNoConfirmed) {
    try {
      const invoice = await showSalesInvoice(order.parasutInvoiceId);
      invoiceNo = (invoice.data.attributes as { invoice_no?: string }).invoice_no ?? null;
      if (invoiceNo) {
        await prisma.order.update({
          where: { postingNumber: decodedPostingNumber },
          data: { parasutInvoiceNo: invoiceNo, parasutInvoiceNoConfirmed: true },
        });
      }
    } catch {
      // Gerçek numara okunamazsa mevcut (muhtemelen geçici) değer kalır — bir sonraki kontrolde
      // tekrar denenir, PDF linki bu arada yine de çalışır.
    }
  }

  // invoiceNo'yu (güncellendiyse) yanıta da ekliyoruz — aksi halde DB'ye yazılan doğru numara
  // sayfa yeniden yüklenene kadar ön yüzde görünmezdi (2026-09-10'da code review'da tespit edildi).
  return NextResponse.json({ status: "ready", pdfUrl: result.pdfUrl, invoiceNo });
}
