import { NextRequest, NextResponse } from "next/server";
import {
  updateDraftVariant,
  deleteVariant,
  setVariantExcludedFromSubmit,
} from "@/modules/products/staging.service";

// importTaskId BigInt — JSON.stringify edilemiyor (ürün Ozon'a gönderilmişse dolu oluyor).
// Bu eksik olduğu için ağırlık/fiyat/pasifleştir işlemleri gönderilmiş ürünlerde 500 atıp
// istemci tarafında sessizce yutuluyordu (fetch sonucu kontrol edilmiyordu).
function serialize(product: { importTaskId: bigint | null } & Record<string, unknown>) {
  return { ...product, importTaskId: product.importTaskId?.toString() ?? null };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const body = (await request.json()) as {
    weightGrams?: number;
    costPrice?: string;
    unitsInPack?: number;
    name?: string;
    heavyPackaging?: boolean;
    excludedFromSubmit?: boolean;
  };

  if (body.excludedFromSubmit !== undefined) {
    const product = await setVariantExcludedFromSubmit(decodeURIComponent(offerId), body.excludedFromSubmit);
    return NextResponse.json({ product: serialize(product) });
  }

  const product = await updateDraftVariant(decodeURIComponent(offerId), body);
  return NextResponse.json({ product: serialize(product) });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const deleted = await deleteVariant(decodeURIComponent(offerId));
  if (!deleted) {
    return NextResponse.json({ error: "Bu varyant bulunamadı" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
