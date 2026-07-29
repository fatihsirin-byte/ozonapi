import { NextRequest, NextResponse } from "next/server";
import { createProduct, listAllProducts, type CreateProductInput } from "@/modules/products/products.service";
import { OzonApiError } from "@/ozon/client";

export async function GET() {
  const products = await listAllProducts();
  // importTaskId BigInt — JSON.stringify edilemiyor, string'e çevirip dönüyoruz.
  const serialized = products.map((p) => ({ ...p, importTaskId: p.importTaskId?.toString() ?? null }));
  return NextResponse.json({ products: serialized });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CreateProductInput;

  try {
    const { taskId } = await createProduct(body);
    return NextResponse.json({ taskId });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    throw error;
  }
}
