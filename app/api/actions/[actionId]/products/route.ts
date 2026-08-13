import { NextRequest, NextResponse } from "next/server";
import { listActionCandidates, listActionProducts, activateActionProducts, deactivateActionProducts } from "@/ozon/actions";
import { OzonApiError } from "@/ozon/client";

export async function GET(request: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await params;
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") === "candidates" ? "candidates" : "participating";

  try {
    const { result } =
      type === "candidates"
        ? await listActionCandidates(Number(actionId), 1000)
        : await listActionProducts(Number(actionId), 1000);
    return NextResponse.json({ products: result.products, total: result.total });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Ürünler alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// Ürünü aksiyona katar — GERÇEK, canlı bir aksiyona ekler (bkz. src/ozon/actions.ts yorumu).
export async function POST(request: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await params;
  const body = (await request.json()) as { productId: number; actionPrice: number };

  try {
    const { result } = await activateActionProducts(Number(actionId), [
      { productId: body.productId, actionPrice: body.actionPrice },
    ]);
    if (result.rejected?.length) {
      return NextResponse.json({ error: result.rejected[0].reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Aksiyona eklenemedi";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await params;
  const body = (await request.json()) as { productId: number };

  try {
    await deactivateActionProducts(Number(actionId), [body.productId]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Aksiyondan çıkarılamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
