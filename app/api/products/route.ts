import { NextRequest, NextResponse } from "next/server";
import { createProduct, listAllProducts, listProductsPage, type CreateProductInput } from "@/modules/products/products.service";
import { OzonApiError } from "@/ozon/client";

// ?q=&page=&pageSize= verilirse (Fiyat sayfası) aranabilir/sayfalı liste döner; hiçbiri
// verilmezse (Ürünler sayfasının eski davranışı) tüm ürünler tek seferde döner.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = searchParams.get("page");
  const pageSize = searchParams.get("pageSize");
  const q = searchParams.get("q");

  if (page || pageSize || q) {
    const result = await listProductsPage(Number(page) || 1, Number(pageSize) || 25, { q: q ?? undefined });
    return NextResponse.json(result);
  }

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
