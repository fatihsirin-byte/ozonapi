import { NextRequest, NextResponse } from "next/server";
import { listActionCandidates, listActionProducts, activateActionProducts, deactivateActionProducts } from "@/ozon/actions";
import { getProductsByOzonProductIds } from "@/modules/products/products.service";
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

    // Ozon product_id -> bizim Product'ımız (görsel/isim/costPrice/ağırlık — Fiyat
    // Hesaplayıcı modalı ve kart görünümü için, /fiyat sayfasındaki aynı desen).
    const localByProductId = await getProductsByOzonProductIds(result.products.map((p) => String(p.id)));
    const products = result.products.map((p) => {
      const local = localByProductId.get(String(p.id));
      return {
        ...p,
        offerId: local?.offerId ?? null,
        name: local?.name ?? `Ürün ${p.id}`,
        images: local?.images ?? null,
        costPrice: local?.costPrice ?? null,
        weightGrams: local?.weightGrams ?? null,
        cargoWeightGrams: local?.cargoWeightGrams ?? null,
        heavyPackaging: local?.heavyPackaging ?? false,
        widthCm: local?.widthCm ?? null,
        heightCm: local?.heightCm ?? null,
        depthCm: local?.depthCm ?? null,
      };
    });

    return NextResponse.json({ products, total: result.total });
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
