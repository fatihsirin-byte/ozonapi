import { NextRequest, NextResponse } from "next/server";
import { shipOrder } from "@/modules/orders/orders.service";
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
    // Ozon'un GERÇEK istek sırasında verdiği bir hata (OzonApiError) — shipOrder bu durumda
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
