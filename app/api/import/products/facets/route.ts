import { NextRequest, NextResponse } from "next/server";
import { getFacets } from "@/modules/products/staging.service";

export async function GET(request: NextRequest) {
  const vendor = request.nextUrl.searchParams.get("vendor") ?? undefined;
  const type = request.nextUrl.searchParams.get("type") ?? undefined;
  const search = request.nextUrl.searchParams.get("q") ?? undefined;
  const statusParam = request.nextUrl.searchParams.get("status");
  const status = statusParam === "draft" || statusParam === "submitted" ? statusParam : undefined;

  const facets = await getFacets({ vendor, type, search, status });
  return NextResponse.json(facets);
}
