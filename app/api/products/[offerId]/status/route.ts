import { NextRequest, NextResponse } from "next/server";
import { checkImportStatus } from "@/modules/products/products.service";

// route.ts'e gelen params Next tarafından zaten çözülmüş oluyor — tekrar decode ETME (bkz.
// app/api/products/[offerId]/route.ts'teki uyarı yorumu).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const status = await checkImportStatus(offerId);
  return NextResponse.json(status);
}
