import { NextRequest, NextResponse } from "next/server";
import { getCategoryAttributes } from "@/ozon/categories";

export async function GET(request: NextRequest, { params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  const typeId = request.nextUrl.searchParams.get("typeId");
  if (!typeId) {
    return NextResponse.json({ error: "typeId query param is required" }, { status: 400 });
  }

  const { result } = await getCategoryAttributes({
    descriptionCategoryId: Number(categoryId),
    typeId: Number(typeId),
    languageCode: "EN",
  });

  return NextResponse.json({ attributes: result.filter((attr) => attr.is_required) });
}
