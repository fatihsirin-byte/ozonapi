import { NextRequest, NextResponse } from "next/server";
import { submitHandleToOzon } from "@/modules/products/staging.service";
import type { ProductAttributeInput } from "@/modules/products/products.service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const body = (await request.json()) as {
    descriptionCategoryId?: number;
    typeId?: number;
    attributes?: ProductAttributeInput[];
  };

  if (!body.descriptionCategoryId || !body.typeId) {
    return NextResponse.json({ error: "Kategori seçilmedi" }, { status: 400 });
  }

  const results = await submitHandleToOzon({
    handle: decodeURIComponent(handle),
    descriptionCategoryId: body.descriptionCategoryId,
    typeId: body.typeId,
    attributes: body.attributes ?? [],
  });

  return NextResponse.json({ results });
}
