import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsBySku } from "@/ozon/analytics";
import { getProductInfoBySku } from "@/ozon/products";
import { OzonApiError } from "@/ozon/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");
  const limit = Number(searchParams.get("limit")) || 20;
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "from ve to (YYYY-MM-DD) gerekli" }, { status: 400 });
  }

  try {
    const { result } = await getAnalyticsBySku(dateFrom, dateTo, 1000);
    const items = result.data
      .map((row) => ({
        sku: row.dimensions[0]?.id ?? "",
        name: row.dimensions[0]?.name ?? "",
        revenue: row.metrics[0] ?? 0,
        orderedUnits: row.metrics[1] ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    // sku'yu bizim offerId'mize çevir ki üründe adına tıklanınca kendi ürün kartımıza
    // (/products/[offerId]) gidebilelim — Ozon'un sku'su bizim SKU'muz (offerId) değil.
    const skus = items.map((i) => i.sku).filter(Boolean);
    const offerIdBySku = new Map<string, string>();
    if (skus.length > 0) {
      try {
        const { items: ozonItems } = await getProductInfoBySku(skus);
        for (const it of ozonItems as any[]) {
          const matchedSku = it.sources?.[0]?.sku ?? it.sku;
          if (matchedSku != null && it.offer_id) offerIdBySku.set(String(matchedSku), it.offer_id);
        }
      } catch {
        // offerId çözülemezse link olmadan (sadece isim) gösteriyoruz — analitik yine de çalışsın.
      }
    }

    const itemsWithLink = items.map((i) => ({ ...i, offerId: offerIdBySku.get(i.sku) ?? null }));

    return NextResponse.json({ items: itemsWithLink });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Analitik verisi alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
