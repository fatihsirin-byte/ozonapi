import { NextRequest, NextResponse } from "next/server";
import { listDraftHandlesPage } from "@/modules/products/staging.service";

export async function GET(request: NextRequest) {
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "25") || 25;
  const vendor = request.nextUrl.searchParams.get("vendor") ?? undefined;
  const search = request.nextUrl.searchParams.get("q") ?? undefined;

  const result = await listDraftHandlesPage(page, pageSize, { vendor, search });
  return NextResponse.json(result);
}
