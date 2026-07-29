import { NextRequest, NextResponse } from "next/server";
import { searchAttributeValues, getAttributeValues } from "@/ozon/categories";

export async function GET(request: NextRequest, { params }: { params: Promise<{ attributeId: string }> }) {
  const { attributeId } = await params;
  const categoryId = request.nextUrl.searchParams.get("categoryId");
  const typeId = request.nextUrl.searchParams.get("typeId");
  const query = request.nextUrl.searchParams.get("q") ?? "";

  if (!categoryId || !typeId) {
    return NextResponse.json({ error: "categoryId and typeId query params are required" }, { status: 400 });
  }

  const shared = {
    attributeId: Number(attributeId),
    descriptionCategoryId: Number(categoryId),
    typeId: Number(typeId),
  };

  const { result } = query
    ? await searchAttributeValues({ ...shared, value: query })
    : await getAttributeValues({ ...shared, limit: 20 });

  return NextResponse.json({ values: result });
}
