import { NextRequest, NextResponse } from "next/server";
import { searchStagedProducts } from "@/modules/products/staging.service";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const excludeHandle = request.nextUrl.searchParams.get("excludeHandle") ?? undefined;
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchStagedProducts(q, excludeHandle);
  return NextResponse.json({ results });
}
