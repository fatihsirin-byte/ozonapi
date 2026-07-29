import { NextRequest, NextResponse } from "next/server";
import { getProduct, updateProductPrice, updateProductImages } from "@/modules/products/products.service";
import { OzonApiError } from "@/ozon/client";

// importTaskId BigInt — JSON.stringify edilemiyor, string'e çevirip dönüyoruz.
function serializeProduct(product: NonNullable<Awaited<ReturnType<typeof getProduct>>>) {
  return { ...product, importTaskId: product.importTaskId?.toString() ?? null };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const product = await getProduct(offerId);
  if (!product) {
    return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ product: serializeProduct(product) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const body = (await request.json()) as { costPrice?: string; images?: string[] };

  try {
    if (body.costPrice !== undefined) {
      await updateProductPrice(offerId, body.costPrice);
    }
    if (body.images !== undefined) {
      await updateProductImages(offerId, body.images);
    }
    const product = await getProduct(offerId);
    return NextResponse.json({ product: product ? serializeProduct(product) : null });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
