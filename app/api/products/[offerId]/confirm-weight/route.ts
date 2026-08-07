import { NextRequest, NextResponse } from "next/server";
import { confirmRealWeight } from "@/modules/products/products.service";
import { OzonApiError } from "@/ozon/client";

// Sipariş ekranından gerçek (tartılmış) ağırlık ilk kez girildiğinde çağrılır — bir daha
// sorulmaması için Product.weightConfirmed işaretlenir ve fiyat bu ağırlığa göre yeniden hesaplanır.
export async function POST(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const body = (await request.json()) as { realWeightGrams?: number };

  if (!body.realWeightGrams || body.realWeightGrams <= 0) {
    return NextResponse.json({ error: "Geçerli bir ağırlık girin" }, { status: 400 });
  }

  try {
    const result = await confirmRealWeight(offerId, Math.round(body.realWeightGrams));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
