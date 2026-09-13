import { NextResponse } from "next/server";
import { prisma } from "@/db/prisma";
import { sendOrderToAse, resolveOrderHsCodes } from "@/ase/orderShipment";
import { HSCODE_ERROR_CODE } from "@/ase/constants";

// Kullanıcının sipariş sayfasındaki "ASE'ye Gönder" butonuna basmasıyla tetiklenir — ASE'ye
// (gümrük/ETGB) bildirim artık SADECE elle yapılıyor, otomatik bir tetikleyici yok (2026-09-13,
// kullanıcı talebi: önceki "fatura kesilince + 15 dakikalık cron'da kendiliğinden dener" mantığı
// öngörülemez bulundu). sendOrderToAse hiçbir zaman exception fırlatmaz, sonucu Order üzerine
// (aseShipmentSuccess/Message/ErrorCode) kaydeder — burada sadece o sonucu okuyup döndürüyoruz.
// `items` (her kalemin şu an kullanılan HS kodu), hata "34" (geçersiz/eksik HS kodu) olduğunda
// ön yüzdeki düzelt-ve-tekrar-dene popup'ını doldurmak için (2026-09-13, kullanıcı talebi).
export async function POST(_request: Request, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const decoded = decodeURIComponent(postingNumber);

  await sendOrderToAse(decoded);

  const order = await prisma.order.findUnique({
    where: { postingNumber: decoded },
    select: { aseShipmentSentAt: true, aseShipmentSuccess: true, aseShipmentMessage: true, aseShipmentErrorCode: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  }

  // Sadece HS kod hatasında gerekli (bkz. AseShipmentButton.tsx popup) — başarılı ya da başka bir
  // nedenle başarısız her gönderimde gereksiz yere Ozon'a kategori öznitelik isteği atmamak için
  // (2026-09-13 code review'da tespit edildi) sadece bu durumda hesaplanıyor.
  const items = order.aseShipmentErrorCode === HSCODE_ERROR_CODE ? await resolveOrderHsCodes(decoded) : [];

  return NextResponse.json({
    sentAt: order.aseShipmentSentAt,
    success: order.aseShipmentSuccess,
    message: order.aseShipmentMessage,
    errorCode: order.aseShipmentErrorCode,
    items,
  });
}
