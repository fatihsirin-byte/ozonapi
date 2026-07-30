import { NextRequest, NextResponse } from "next/server";
import { deleteHandles } from "@/modules/products/staging.service";

export async function POST(request: NextRequest) {
  const { handles } = (await request.json()) as { handles?: string[] };
  if (!handles?.length) {
    return NextResponse.json({ error: "handles gerekli" }, { status: 400 });
  }

  const count = await deleteHandles(handles);
  return NextResponse.json({ deleted: count });
}
