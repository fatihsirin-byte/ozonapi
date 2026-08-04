import { NextRequest, NextResponse } from "next/server";
import { getOrderDetail, updatePurchaseInvoiceNumber } from "@/modules/orders/orders.service";

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const body = (await request.json()) as { purchaseInvoiceNumber?: string | null };

  if (body.purchaseInvoiceNumber !== undefined) {
    await updatePurchaseInvoiceNumber(decodeURIComponent(postingNumber), body.purchaseInvoiceNumber);
  }

  const order = await getOrderDetail(decodeURIComponent(postingNumber));
  if (!order) {
    return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({
    order: { ...order, transactions: order.transactions.map((t) => ({ ...t, operationId: t.operationId.toString() })) },
  });
}
