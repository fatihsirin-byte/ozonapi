import { NextRequest, NextResponse } from "next/server";
import { getAdjacentHandles } from "@/modules/products/staging.service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const result = await getAdjacentHandles(decodeURIComponent(handle), {
    vendor: searchParams.get("vendor") ?? undefined,
    type: searchParams.get("type") ?? undefined,
    search: searchParams.get("q") ?? undefined,
    status: status === "draft" || status === "submitted" ? status : undefined,
  });
  return NextResponse.json(result);
}
