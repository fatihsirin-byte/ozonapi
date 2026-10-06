import { NextResponse } from "next/server";
import { getShopifyImportJobStatus, startShopifyImportJob } from "@/shopify/importJob";

export async function GET() {
  return NextResponse.json(getShopifyImportJobStatus());
}

export async function POST() {
  const { started, status } = startShopifyImportJob();
  return NextResponse.json(status, { status: started ? 202 : 409 });
}
