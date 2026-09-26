import { NextRequest, NextResponse } from "next/server";
import { getToptantrPreview, connectHandleToToptantr } from "@/modules/toptantr/toptantr.service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  try {
    const preview = await getToptantrPreview(handle);
    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const body = (await request.json()) as { categoryGuid?: string; brandGuid?: string | null };
  if (!body.categoryGuid) {
    return NextResponse.json({ error: "categoryGuid gerekli" }, { status: 400 });
  }
  try {
    const listing = await connectHandleToToptantr({ handle, categoryGuid: body.categoryGuid, brandGuid: body.brandGuid ?? null });
    return NextResponse.json({ listing });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
