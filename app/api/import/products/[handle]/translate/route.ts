import { NextRequest, NextResponse } from "next/server";
import { translateHandle } from "@/modules/products/staging.service";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  try {
    const result = await translateHandle(decodeURIComponent(handle));
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Çeviri başarısız";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
