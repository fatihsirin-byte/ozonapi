import { NextResponse } from "next/server";
import { getOrderDetail } from "@/modules/orders/orders.service";

export async function GET(_request: Request, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const order = await getOrderDetail(decodeURIComponent(postingNumber));
  if (!order) {
    return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  }

  const serialized = {
    ...order,
    transactions: order.transactions.map((t) => ({ ...t, operationId: t.operationId.toString() })),
  };

  return NextResponse.json({ order: serialized });
}
