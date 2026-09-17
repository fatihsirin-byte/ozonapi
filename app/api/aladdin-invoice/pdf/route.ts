import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/prisma";
import { findActiveEInvoice, getEInvoicePdfUrl } from "@/parasut/aladdinEInvoice";
import { ParasutApiError } from "@/parasut/client";

export const dynamic = "force-dynamic";

// Kullanıcı bulgusu (2026-09-17): "Faturayı Görüntüle" (Paraşüt'ün kendi /print sayfasına giden
// harici link) tarayıcıda Paraşüt'e Aladdin ŞİRKETİ değil başka bir şirket seçiliyken açılırsa
// "ActiveRecord::RecordNotFound" veriyordu — kullanıcının tarayıcı oturumuna/aktif şirket
// seçimine bağımlı bu zayıf halkayı ortadan kaldırmak için (kullanıcı talebi: "kendin PDF
// görüntüleyici göm"), PDF'i kullanıcının tarayıcısı yerine SUNUCUMUZ, kendi (Aladdin'e sabit)
// API kimlik bilgileriyle çekip doğrudan servis ediyor — sonuç kullanıcının Paraşüt'te hangi
// şirketi seçtiğinden TAMAMEN bağımsız.
export async function GET(request: NextRequest) {
  const invoiceId = request.nextUrl.searchParams.get("invoiceId");
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId eksik" }, { status: 400 });
  }

  // Sunucumuzu keyfi bir Paraşüt fatura kimliğini sorgulayabilen açık bir proxy'e çevirmemek için
  // — sadece BİZİM daha önce GERÇEKTEN oluşturduğumuz (Order.aladdinInvoiceId'de kayıtlı) bir
  // kimlik kabul ediliyor. aladdinEInvoiceStatus da BURADA okunuyor — aşağıdaki 404 mesajını
  // "e-Fatura'ya hiç ihtiyaç yoktu" ile "e-Fatura'ya dönüştürme BAŞARISIZ oldu" arasında ayırt
  // edebilmek için (2026-09-17 code review'da tespit edildi: ikisi de findActiveEInvoice'tan null
  // dönüyor, ama kullanıcıya söylenmesi gereken şey çok farklı).
  const known = await prisma.order.findFirst({
    where: { aladdinInvoiceId: invoiceId },
    select: { aladdinEInvoiceStatus: true },
  });
  if (!known) {
    return NextResponse.json({ error: "Bilinmeyen fatura kimliği" }, { status: 404 });
  }

  try {
    const active = await findActiveEInvoice(invoiceId);
    if (!active) {
      if (known.aladdinEInvoiceStatus === "failed") {
        // Fatura oluştu ama e-Fatura'ya dönüştürme adımı GERÇEKTEN başarısız oldu (bkz.
        // aladdinInvoice.ts) — bu, e-Fatura'ya hiç ihtiyaç olmayan eski/düz bir faturayla
        // KARIŞTIRILMAMALI, kullanıcı bunu Paraşüt panelinden ELLE tamamlamalı.
        return NextResponse.json(
          { error: "Bu faturanın e-Fatura'ya dönüştürme adımı başarısız olmuştu, PDF üretilemiyor — Paraşüt panelinden elle tamamlamanız gerekiyor." },
          { status: 404 },
        );
      }
      // Fatura hiç e-Fatura'ya dönüştürülmemiş (ör. Fatih Gezgin henüz e-Fatura mükellefi değilken
      // kesilmiş eski, "düz" bir fatura) — bu tür faturalar için Paraşüt'ün /pdf API'si yok, sadece
      // web sayfası (/print) var; o link zaten panelde AYRICA gösteriliyor.
      return NextResponse.json(
        { error: "Bu fatura için e-Fatura kaydı yok, PDF üretilemiyor — Paraşüt panelinden görüntüleyin." },
        { status: 404 },
      );
    }
    const pdfUrl = await getEInvoicePdfUrl(active.eInvoiceId);
    if (!pdfUrl) {
      // "data" alanı henüz YOKSA (GİB/Paraşüt PDF'i henüz hazırlamadıysa) bu NORMAL bir durumdur —
      // eArchives.ts'teki AYNI bekleme deseni (bkz. o dosyadaki getEArchivePdfUrl yorumu). 503,
      // frontend'in "PDF geldi" (200) ile "henüz hazır değil/hata" (200 dışı) durumlarını JSON'a
      // bakmadan, sadece HTTP durumuna göre ayırabilmesi için BİLEREK 200 aralığı DIŞINDA.
      return NextResponse.json({ error: "PDF henüz hazırlanıyor — birkaç saniye sonra tekrar deneyin." }, { status: 503 });
    }
    // fetch/arrayBuffer KENDİ try/catch'inde — ağ hatası (zaman aşımı, bağlantı kopması vb.)
    // ParasutApiError DEĞİL, aşağıdaki genel catch'e düşüp Next.js'in ham/JSON-olmayan hata
    // sayfasını döndürürdü (2026-09-17 code review'da tespit edildi: çağıran taraf her zaman JSON
    // bekliyor).
    let buffer: ArrayBuffer;
    try {
      const pdfRes = await fetch(pdfUrl);
      if (!pdfRes.ok) {
        return NextResponse.json({ error: "PDF indirilemedi, Paraşüt geçici bir hata verdi." }, { status: 502 });
      }
      buffer = await pdfRes.arrayBuffer();
    } catch (fetchErr) {
      console.error(`[aladdin-invoice-pdf] PDF indirilirken ağ hatası (invoiceId ${invoiceId}):`, fetchErr);
      return NextResponse.json({ error: "PDF indirilemedi, bağlantı hatası oluştu — tekrar deneyin." }, { status: 502 });
    }
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoiceId}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof ParasutApiError) {
      return NextResponse.json({ error: `Paraşüt'e bağlanırken sorun oluştu: ${error.message}` }, { status: error.status ?? 502 });
    }
    throw error;
  }
}
