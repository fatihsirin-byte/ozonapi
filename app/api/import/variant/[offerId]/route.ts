import { NextRequest, NextResponse } from "next/server";
import { updateDraftVariant } from "@/modules/products/staging.service";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const body = (await request.json()) as { weightGrams?: number; costPrice?: string };

  const product = await updateDraftVariant(decodeURIComponent(offerId), body);
  return NextResponse.json({ product });
}
