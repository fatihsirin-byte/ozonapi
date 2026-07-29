import { NextRequest, NextResponse } from "next/server";
import { searchCategories } from "@/ozon/category-cache";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const results = await searchCategories(query);
  return NextResponse.json({ results });
}
