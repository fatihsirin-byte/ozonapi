import { NextRequest, NextResponse } from "next/server";
import { getPnlSummary } from "@/modules/finance/finance.service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since") ? new Date(searchParams.get("since")!) : undefined;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;

  const summary = await getPnlSummary({ since, to });
  return NextResponse.json(summary);
}
