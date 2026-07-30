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

  // Varsayılan: sadece zorunlu attribute'lar (mevcut wizard davranışı korunuyor).
  // includeOptional=1 verilirse opsiyonel olanlar da döner (Annotation, Composition, PDF, JSON
  // rich content, Ozon.Video vb. — Ozon'un içerik kalite puanını artıran ama zorunlu olmayan alanlar).
  const includeOptional = request.nextUrl.searchParams.get("includeOptional") === "1";
  const attributes = includeOptional ? result : result.filter((attr) => attr.is_required);

  return NextResponse.json({ attributes });
}
