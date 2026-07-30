import { NextRequest, NextResponse } from "next/server";
import {
  updateDraftVariant,
  deleteVariant,
  setVariantExcludedFromSubmit,
} from "@/modules/products/staging.service";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const body = (await request.json()) as { weightGrams?: number; costPrice?: string; excludedFromSubmit?: boolean };

  if (body.excludedFromSubmit !== undefined) {
    const product = await setVariantExcludedFromSubmit(decodeURIComponent(offerId), body.excludedFromSubmit);
    return NextResponse.json({ product });
  }

  const product = await updateDraftVariant(decodeURIComponent(offerId), body);
  return NextResponse.json({ product });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const deleted = await deleteVariant(decodeURIComponent(offerId));
  if (!deleted) {
    return NextResponse.json({ error: "Bu varyant silinemez (draft değil ya da bulunamadı)" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
