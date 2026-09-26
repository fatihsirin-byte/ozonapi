import { NextRequest, NextResponse } from "next/server";
import { getToptantrCategories, searchCategories } from "@/toptantr/mapping";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const categories = await getToptantrCategories();
    return NextResponse.json({ results: searchCategories(categories, q) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
