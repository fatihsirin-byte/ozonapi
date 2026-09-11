import { NextRequest, NextResponse } from "next/server";
import { getTopSellingProducts } from "@/modules/orders/orders.service";
import { productPath } from "@/utils/decodeOfferId";

// Ozon'un rate-limit'e (429) çok takılan analitik uç noktası yerine kendi local sipariş
// verimizden hesaplıyor — bkz. orders.service.ts getTopSellingProducts açıklaması (2026-09-11,
// kullanıcı talebi).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");
  const limit = Number(searchParams.get("limit")) || 20;
  const q = searchParams.get("q") ?? undefined;
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "from ve to (YYYY-MM-DD) gerekli" }, { status: 400 });
  }

  const since = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T23:59:59.999Z`);
  if (Number.isNaN(since.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "from/to geçerli bir tarih (YYYY-MM-DD) olmalı" }, { status: 400 });
  }

  try {
    const items = await getTopSellingProducts({ since, to, limit, search: q });
    return NextResponse.json({
      items: items.map((i) => ({ ...i, href: productPath(i.offerId) })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analitik verisi alınamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
