import { NextRequest, NextResponse } from "next/server";
import { importFromOzon } from "@/modules/products/products.service";
import { OzonApiError } from "@/ozon/client";

export async function POST(request: NextRequest) {
  const { offerId } = (await request.json()) as { offerId?: string };
  if (!offerId) {
    return NextResponse.json({ error: "offerId gerekli" }, { status: 400 });
  }

  try {
    const product = await importFromOzon(offerId);
    return NextResponse.json({ product: { ...product, importTaskId: product.importTaskId?.toString() ?? null } });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
