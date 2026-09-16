import { NextRequest, NextResponse } from "next/server";
import { buildDailyAladdinInvoicePreview, createDailyAladdinInvoice, AladdinInvoiceError } from "@/parasut/aladdinInvoice";
import { ParasutApiError } from "@/parasut/client";

// GET: sadece ÖNİZLEME — hiçbir şey oluşturmaz, hiçbir Aladdin/Fatih Gezgin isteği ATMAZ (Paraşüt'e
// sadece USD/TL kuru için bir istek gider). Kullanıcı sayfayı her açtığında/yenilediğinde güvenle
// çağrılabilir.
export async function GET() {
  try {
    const preview = await buildDailyAladdinInvoicePreview();
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof AladdinInvoiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ParasutApiError) {
      return NextResponse.json({ error: error.message, body: error.body }, { status: error.status ?? 502 });
    }
    throw error;
  }
}

// POST: GERÇEK, geri alınamaz bir Paraşüt satış faturası oluşturur (Aladdin'in hesabında, Fatih
// Gezgin'e). SADECE ELLE tetiklenir (bkz. app/aladdin-fatura/page.tsx) — kullanıcı kararı
// (2026-09-16): "önce elle/manuel buton", birkaç gün sonuçlar doğrulanınca otomatik 17:00 cron'a
// geçilecek.
//
// `postingNumbers` istek gövdesinde ZORUNLU — ön yüzün GET /api/aladdin-invoice'tan az önce
// aldığı, kullanıcının onay diyaloğunda GÖRDÜĞÜ TAM KÜME. Burada yeniden tarih aralığı
// sorgulamıyoruz: önizleme ile onay arasında yeni bir sipariş faturalanmış olabilir, onu sessizce
// dahil etmek kullanıcının onayladığından FARKLI bir tutar/fatura kesilmesine yol açardı
// (2026-09-16 code review'da tespit edildi).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const postingNumbers = Array.isArray(body.postingNumbers) ? body.postingNumbers.filter((p: unknown) => typeof p === "string") : [];
    const result = await createDailyAladdinInvoice(postingNumbers);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AladdinInvoiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ParasutApiError) {
      return NextResponse.json({ error: error.message, body: error.body }, { status: error.status ?? 502 });
    }
    throw error;
  }
}
