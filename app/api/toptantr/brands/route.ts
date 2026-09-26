import { NextRequest, NextResponse } from "next/server";
import { getToptantrBrands, searchBrands } from "@/toptantr/mapping";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const brands = await getToptantrBrands();
    return NextResponse.json({ results: searchBrands(brands, q) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
