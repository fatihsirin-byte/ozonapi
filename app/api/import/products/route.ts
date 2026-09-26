import { NextRequest, NextResponse } from "next/server";
import { listDraftHandlesPage } from "@/modules/products/staging.service";

export async function GET(request: NextRequest) {
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "25") || 25;
  const vendor = request.nextUrl.searchParams.get("vendor") ?? undefined;
  const type = request.nextUrl.searchParams.get("type") ?? undefined;
  const search = request.nextUrl.searchParams.get("q") ?? undefined;
  const statusParam = request.nextUrl.searchParams.get("status");
  const status = statusParam === "draft" || statusParam === "submitted" ? statusParam : undefined;
  const marketplaceParam = request.nextUrl.searchParams.get("marketplace");
  const marketplace =
    marketplaceParam === "ozon" || marketplaceParam === "toptantr" || marketplaceParam === "both"
      ? marketplaceParam
      : undefined;

  const result = await listDraftHandlesPage(page, pageSize, { vendor, type, search, status, marketplace });
  return NextResponse.json(result);
}
