import { NextRequest, NextResponse } from "next/server";
import { checkImportStatus } from "@/modules/products/products.service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const status = await checkImportStatus(offerId);
  return NextResponse.json(status);
}
