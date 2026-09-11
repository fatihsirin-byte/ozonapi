import { NextRequest, NextResponse } from "next/server";
import { shipOrder, SafeShipFailureError } from "@/modules/orders/orders.service";
import { OzonApiError } from "@/ozon/client";

// Ozon panelindeki "Topla" — siparişi paketleyip kargoya hazır hale getirir. GERÇEK bir sevkiyat
// onayı Ozon'a gönderilir, geri alınamaz (bkz. BEKLEYEN-GELISTIRMELER.md #3).
export async function POST(request: NextRequest, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const decoded = decodeURIComponent(postingNumber);
  const body = (await request.json().catch(() => ({}))) as { multiBoxQty?: number };

  try {
    const result = await shipOrder(decoded, body.multiBoxQty);
    return NextResponse.json(result);
  } catch (error) {
    // SafeShipFailureError: Ozon'a GERÇEK bir ship isteği gitti ve Ozon bunu KESİN/senkron olarak
    // reddetti (ör. 4xx, 409 hariç) — kilit bu yüzden serbest bırakıldı, siparişte hiçbir şey
    // "askıda" kalmadı ama istek Ozon'a ulaştı ve işlenmedi (2026-09-11'de gerçek bir siparişte
    // yaşandı: POSTING_DOES_NOT_HAVE_MULTI_BOX_PRODUCT hatası — önceki mesaj yanlışlıkla "hiç
    // istek gitmedi" diyordu, code review'da düzeltildi).
    if (error instanceof SafeShipFailureError) {
      const cause = error.cause;
      const ozonMessage = cause instanceof OzonApiError ? cause.message : error.message;
      return NextResponse.json(
        {
          error: `Ozon isteği reddetti: ${ozonMessage} — istek Ozon'a gitti ve Ozon kesin olarak reddetti, siparişte paketleme GERÇEKLEŞMEDİ, tekrar deneyebilirsiniz.`,
          ozon: cause instanceof OzonApiError ? cause.body : undefined,
        },
        // Ozon'un GERÇEK durum kodu varsa onu koru (sabit 400 yerine) — aşağıdaki genel OzonApiError
        // dalıyla tutarlı olsun diye (2026-09-11'de code review'da tespit edildi: burada hep 400
        // dönüyordu, Ozon 403/422 gibi başka bir kod döndürse bile).
        { status: (cause instanceof OzonApiError ? cause.status : undefined) ?? 400 },
      );
    }
    // Ozon'un GERÇEK ship isteği sırasında verdiği bir hata (OzonApiError) — shipOrder bu durumda
    // Ozon'un güncel durumunu zaten kendisi kontrol etmeye çalıştı (bkz. orders.service.ts); yine
    // de kesin bilinmiyorsa siparişi kilitli bırakır — kullanıcıyı Ozon panelinden bakmaya
    // yönlendiriyoruz, "tekrar dene" demiyoruz.
    if (error instanceof OzonApiError) {
      return NextResponse.json(
        {
          error: `Ozon hata döndürdü: ${error.message} — bu siparişin gerçekten paketlenip paketlenmediği tam doğrulanamadı, tekrar denemeden ÖNCE Ozon panelinden kontrol edin.`,
          ozon: error.body,
        },
        { status: error.status ?? 502 },
      );
    }
    const message = error instanceof Error ? error.message : "Paketlenemedi";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
