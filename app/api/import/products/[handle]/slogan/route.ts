import { NextRequest, NextResponse } from "next/server";
import { generateSloganSet } from "@/ai/slogan";
import { prisma } from "@/db/prisma";

export async function POST(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const body = (await request.json().catch(() => ({}))) as { productName?: string };

  let productName = body.productName?.trim();
  if (!productName) {
    const first = await prisma.product.findFirst({ where: { shopifyHandle: decodeURIComponent(handle) } });
    productName = first?.name;
  }
  if (!productName) {
    return NextResponse.json({ error: "Ürün adı bulunamadı" }, { status: 400 });
  }

  try {
    const result = await generateSloganSet(productName);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
