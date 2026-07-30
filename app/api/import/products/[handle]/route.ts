import { NextRequest, NextResponse } from "next/server";
import { getHandleGroup, updateDraftImages } from "@/modules/products/staging.service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const variants = await getHandleGroup(decodeURIComponent(handle));
  if (variants.length === 0) {
    return NextResponse.json({ error: "Handle bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ variants });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const { images } = (await request.json()) as { images?: string[] };
  if (images === undefined) {
    return NextResponse.json({ error: "images gerekli" }, { status: 400 });
  }
  await updateDraftImages(decodeURIComponent(handle), images);
  const variants = await getHandleGroup(decodeURIComponent(handle));
  return NextResponse.json({ variants });
}
