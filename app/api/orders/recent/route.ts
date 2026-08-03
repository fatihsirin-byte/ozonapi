import { NextRequest, NextResponse } from "next/server";
import { getRecentOrders, computeOrderAmount } from "@/modules/orders/orders.service";

// Global toast bildirimi için — istemci her ~20 saniyede bir son kontrolünden SONRA senkronize
// edilmiş (Order.createdAt > since) siparişleri kalem+ürün özetiyle çeker.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sinceParam = searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 60_000);

  const orders = await getRecentOrders(since);

  const result = orders.map((o) => ({
    postingNumber: o.postingNumber,
    amount: computeOrderAmount(o.items),
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((item) => ({
      offerId: item.offerId,
      quantity: item.quantity,
      price: item.price,
      name: item.product?.name ?? item.offerId,
      thumbnail: Array.isArray(item.product?.images) ? (item.product?.images as string[])[0] ?? null : null,
    })),
  }));

  return NextResponse.json({ orders: result, checkedAt: new Date().toISOString() });
}
