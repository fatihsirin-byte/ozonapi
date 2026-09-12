import { NextResponse } from "next/server";
import { prisma } from "@/db/prisma";
import { sendOrderToAse } from "@/ase/orderShipment";

// Kullanıcının sipariş sayfasındaki "ASE'ye Gönder" butonuna basmasıyla tetiklenir — ASE'ye
// (gümrük/ETGB) bildirim artık SADECE elle yapılıyor, otomatik bir tetikleyici yok (2026-09-13,
// kullanıcı talebi: önceki "fatura kesilince + 15 dakikalık cron'da kendiliğinden dener" mantığı
// öngörülemez bulundu). sendOrderToAse hiçbir zaman exception fırlatmaz, sonucu Order üzerine
// (aseShipmentSuccess/Message) kaydeder — burada sadece o sonucu okuyup döndürüyoruz.
export async function POST(_request: Request, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const decoded = decodeURIComponent(postingNumber);

  await sendOrderToAse(decoded);

  const order = await prisma.order.findUnique({
    where: { postingNumber: decoded },
    select: { aseShipmentSentAt: true, aseShipmentSuccess: true, aseShipmentMessage: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  }

  return NextResponse.json({
    sentAt: order.aseShipmentSentAt,
    success: order.aseShipmentSuccess,
    message: order.aseShipmentMessage,
  });
}
