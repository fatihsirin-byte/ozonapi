import { NextResponse } from "next/server";
import { getOrderDetail, fetchEtgbForOrder } from "@/modules/orders/orders.service";

// Salt-okunur — ETGB (Türk gümrük beyannamesi) Ozon/kargo firması tarafından otomatik
// oluşturuluyor, biz sadece siparişe bağlı olanı çekip gösteriyoruz.
export async function GET(_request: Request, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const decoded = decodeURIComponent(postingNumber);
  const order = await getOrderDetail(decoded);
  if (!order) {
    return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  }

  const etgb = await fetchEtgbForOrder(decoded, order.orderDate);
  return NextResponse.json({ etgb });
}
