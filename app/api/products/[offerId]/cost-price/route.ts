import { NextRequest, NextResponse } from "next/server";
import { setCostPriceOnly } from "@/modules/products/products.service";

// Kâr/Zarar raporundaki (bkz. /pnl) "Alış fiyatı gir" inline alanı bunu kullanıyor — sadece
// bizim DB'mizdeki costPrice'ı yazar, Ozon'a canlı fiyat göndermez (bkz. setCostPriceOnly yorumu).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const body = (await request.json().catch(() => ({}))) as { costPrice?: string };

  const costPrice = body.costPrice?.trim();
  const parsed = costPrice ? Number(costPrice) : NaN;
  if (!costPrice || Number.isNaN(parsed) || parsed <= 0) {
    return NextResponse.json({ error: "Geçerli bir alış fiyatı girin" }, { status: 400 });
  }

  try {
    const product = await setCostPriceOnly(offerId, costPrice);
    return NextResponse.json({ costPrice: product.costPrice });
  } catch {
    return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
  }
}
