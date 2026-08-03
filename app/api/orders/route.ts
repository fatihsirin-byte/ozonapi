import { NextRequest, NextResponse } from "next/server";
import { listOrders } from "@/modules/orders/orders.service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const scheme = searchParams.get("scheme") ?? undefined;
  const since = searchParams.get("since") ? new Date(searchParams.get("since")!) : undefined;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;
  const page = Number(searchParams.get("page") ?? "1");
  const take = 50;

  const { orders, total } = await listOrders({ status, scheme, since, to, skip: (page - 1) * take, take });

  return NextResponse.json({ orders, total, page, pageSize: take });
}
