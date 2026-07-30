import { NextRequest, NextResponse } from "next/server";
import { setStockForAllConnectedProducts } from "@/modules/products/products.service";

export async function POST(request: NextRequest) {
  const { stock } = (await request.json().catch(() => ({}))) as { stock?: number };
  const result = await setStockForAllConnectedProducts(stock ?? 100);
  return NextResponse.json(result);
}
