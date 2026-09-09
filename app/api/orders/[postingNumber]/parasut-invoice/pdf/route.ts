import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/prisma";
import { resolveInvoicePdf } from "@/parasut/eArchives";
import { INVOICE_CLAIM_SENTINEL } from "@/parasut/orderInvoice";

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
    select: { parasutInvoiceId: true, parasutEArchiveFailed: true },
  });

  if (!order?.parasutInvoiceId || order.parasutInvoiceId === INVOICE_CLAIM_SENTINEL) {
    return NextResponse.json({ status: "not_invoiced" }, { status: 404 });
  }

  const result = await resolveInvoicePdf(order.parasutInvoiceId, order.parasutEArchiveFailed);

  if (result.status === "ready" && result.recoveredFromFailure) {
    await prisma.order.update({
      where: { postingNumber: decodedPostingNumber },
      data: { parasutEArchiveFailed: false },
    });
  }

  if (result.status === "processing") {
    return NextResponse.json({ status: "processing" }, { status: 202 });
  }

  return NextResponse.json({ status: "ready", pdfUrl: result.pdfUrl });
}
