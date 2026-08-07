import { NextRequest, NextResponse } from "next/server";
import {
  updateDraftVariant,
  deleteVariant,
  setVariantExcludedFromSubmit,
  recalculateFromBase,
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
    cargoWeightGrams?: number | null;
    costPrice?: string;
    unitsInPack?: number;
    name?: string;
    heavyPackaging?: boolean;
    excludedFromSubmit?: boolean;
    recalculateFromBase?: boolean;
  };

  if (body.excludedFromSubmit !== undefined) {
    const product = await setVariantExcludedFromSubmit(decodeURIComponent(offerId), body.excludedFromSubmit);
    return NextResponse.json({ product: serialize(product) });
  }

  if (body.recalculateFromBase) {
    try {
      const product = await recalculateFromBase(decodeURIComponent(offerId));
      return NextResponse.json({ product: serialize(product) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Yeniden hesaplanamadı";
      return NextResponse.json({ error: message }, { status: 400 });
    }
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
