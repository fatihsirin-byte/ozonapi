import { NextRequest, NextResponse } from "next/server";
import { refreshToptantrHandle } from "@/modules/toptantr/toptantr.service";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  try {
    const listing = await refreshToptantrHandle(handle);
    return NextResponse.json({ listing });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
