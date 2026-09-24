import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/prisma";
import { resolveInvoicePdfForOrder, findActiveEArchive } from "@/parasut/eArchives";
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
    select: { parasutInvoiceId: true, parasutInvoiceNoConfirmed: true, parasutInvoiceNo: true },
  });

  if (!order?.parasutInvoiceId || order.parasutInvoiceId === INVOICE_CLAIM_SENTINEL) {
    return NextResponse.json({ status: "not_invoiced" }, { status: 404 });
  }

  // GÜNCELLEME (2026-09-24'te canlıda, kullanıcı bulgusu: "bu status fatura oluştu anlamına
  // geliyor, invoice_number gelmiş, burada beklememize gerek yok" — bkz. src/parasut/eArchives.ts
  // ActiveEArchiveInfo yorumu): fatura numarası ARTIK PDF'in tam indirilebilir olmasını
  // BEKLEMEDEN, e-Arşiv'in kendi invoice_number alanı dolar dolmaz (GİB'e gönderim anında,
  // "reporting" durumundayken bile) onaylanıyor — bu, ASE gönderiminin (parasutInvoiceNoConfirmed'a
  // bağlı) GİB'in daha yavaş nihai onayını beklemeden tetiklenebilmesini sağlıyor. PDF'in kendisi
  // (indirilebilir/görüntülenebilir hali) HÂLÂ ayrı ve gerçekten hazır olmasını gerektiriyor —
  // aşağıdaki resolveInvoicePdfForOrder o yüzden AYRICA çalışıyor, sadece artık invoiceNo onayını
  // ENGELLEMİYOR.
  let invoiceNo = order.parasutInvoiceNo;
  let invoiceConfirmed = order.parasutInvoiceNoConfirmed;
  if (!invoiceConfirmed) {
    try {
      const archive = await findActiveEArchive(order.parasutInvoiceId);
      if (archive?.invoiceNumber) {
        invoiceNo = archive.invoiceNumber;
        invoiceConfirmed = true;
        await prisma.order.update({
          where: { postingNumber: decodedPostingNumber },
          data: { parasutInvoiceNo: invoiceNo, parasutInvoiceNoConfirmed: true },
        });
      }
    } catch {
      // Henüz e-Arşiv/numara okunamadıysa bir sonraki pollingde tekrar denenir.
    }
  }

  const result = await resolveInvoicePdfForOrder(decodedPostingNumber, order.parasutInvoiceId);

  if (result.status === "processing") {
    return NextResponse.json({ status: "processing", invoiceNo, invoiceConfirmed });
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

  // ASE'ye (gümrük/ETGB) gönderim BURADA OTOMATİK yapılmıyor — kullanıcı talebi (2026-09-13):
  // önceki sürüm hem burada hem 15 dakikalık cron'da "kendiliğinden bulup gönderiyordu", bu
  // öngörülemez bulundu. Artık kullanıcı fatura kesildikten sonra kendi isteğiyle sipariş
  // sayfasındaki "ASE'ye Gönder" butonuna basıyor (bkz. AseShipmentButton.tsx,
  // app/api/orders/[postingNumber]/ase-shipment/route.ts) — YA DA fatura numarası onaylanır
  // onaylanmaz src/scripts/sync-orders-cron.ts'teki runAseAutoSend tarafından arka planda
  // (2026-09-23'ten itibaren, kullanıcı onayıyla).

  return NextResponse.json({ status: "ready", pdfUrl: result.pdfUrl, invoiceNo, invoiceConfirmed });
}
