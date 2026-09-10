import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/prisma";
import { readCachedInvoicePdfDetailed } from "@/parasut/pdfCache";

// Diske önbelleğe alınmış fatura PDF'ini döner — Paraşüt'e HİÇ istek atmaz (bkz. src/parasut/pdfCache.ts).
// Gerçek müşteri bilgisi içerdiği için middleware.ts'teki genel giriş kontrolüne tabidir
// (public/uploads'ın aksine).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const decodedPostingNumber = decodeURIComponent(postingNumber);
  // Buffer + "kesin yok mu" bilgisi TEK okumada birlikte alınıyor (2026-09-10'da code review'da
  // tespit edildi: önceden ikisi ayrı çağrıyla aynı dosyayı iki kere okuyordu).
  const { buffer: pdf, confirmedMissing } = await readCachedInvoicePdfDetailed(decodedPostingNumber);
  if (pdf) {
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${decodedPostingNumber}.pdf"`,
      },
    });
  }

  // Dosya beklenmedik şekilde yok (ör. Order.parasutInvoicePdfCached=true ama disk temizlenmiş/
  // taşınmış) — ParasutInvoiceButton bu linke DOĞRUDAN gidiyor, ara bir kontrol yapmıyor (bkz.
  // o bileşenin yorumu), bu yüzden kırık bir link göstermek yerine Paraşüt panel linkine
  // yönlendiriyoruz — fatura zaten kesilmiş olduğu için bu her zaman çalışır (2026-09-10'da code
  // review'da tespit edildi). Bayrağı SADECE dosyanın KESİN olmadığı (ENOENT) doğrulanmışsa
  // düzeltiyoruz — geçici bir okuma hatasında (izin, disk vb.) hâlâ var olabilecek bir PDF için
  // önbellek durumunu yanlışlıkla bozmayalım diye (2026-09-10'da code review'da ayrıca tespit edildi).
  const order = await prisma.order.findUnique({
    where: { postingNumber: decodedPostingNumber },
    select: { parasutPrintUrl: true, parasutInvoicePdfCached: true },
  });
  if (confirmedMissing && order?.parasutInvoicePdfCached) {
    await prisma.order.update({ where: { postingNumber: decodedPostingNumber }, data: { parasutInvoicePdfCached: false } });
  }
  if (order?.parasutPrintUrl) {
    return NextResponse.redirect(order.parasutPrintUrl.replace(/\/print$/, ""));
  }
  return NextResponse.json({ error: "PDF henüz önbelleğe alınmadı" }, { status: 404 });
}
