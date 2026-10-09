import { NextResponse } from "next/server";

// Kaldırıldı (2026-10-09, kullanıcı kararı): "tüm ürünlere sabit stok" artık yok — Ozon'a sadece
// Shopify ile eşleşen ürünler için gerçek stok gidiyor (bkz. src/shopify/stockSync.ts).
export async function POST() {
  return NextResponse.json({ error: "Sabit stok gönderimi kaldırıldı" }, { status: 410 });
}
