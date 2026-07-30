import { NextRequest, NextResponse } from "next/server";
import { linkHandleToModelGroup, unlinkHandleFromModelGroup } from "@/modules/products/staging.service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const { targetOfferId } = (await request.json()) as { targetOfferId?: string };
  if (!targetOfferId) {
    return NextResponse.json({ error: "targetOfferId gerekli" }, { status: 400 });
  }

  try {
    const group = await linkHandleToModelGroup(decodeURIComponent(handle), targetOfferId);
    // importTaskId BigInt — Ozon'a gönderilmiş bir ürün gruba dahilse JSON.stringify çöküyordu.
    const serialized = group && {
      ...group,
      products: group.products.map((p) => ({ ...p, importTaskId: p.importTaskId?.toString() ?? null })),
    };
    return NextResponse.json({ group: serialized });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  await unlinkHandleFromModelGroup(decodeURIComponent(handle));
  return NextResponse.json({ ok: true });
}
