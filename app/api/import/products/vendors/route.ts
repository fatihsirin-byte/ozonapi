import { NextResponse } from "next/server";
import { listDistinctVendors } from "@/modules/products/staging.service";

export async function GET() {
  const vendors = await listDistinctVendors();
  return NextResponse.json({ vendors });
}
