import { NextRequest, NextResponse } from "next/server";
import { setShippingReviewed } from "@/modules/orders/orders.service";

interface ReviewItem {
  postingNumber: string;
  offerId: string;
}

// Kargo Kontrolü sekmesindeki checkbox'lar bunu kullanıyor — bir ya da birden fazla
// (postingNumber, offerId) kalemini "incelendi" (ya da tekrar "incelenmedi") olarak işaretler.
export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { items?: ReviewItem[]; reviewed?: boolean };

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items boş olamaz" }, { status: 400 });
  }
  if (items.some((i) => !i.postingNumber || !i.offerId)) {
    return NextResponse.json({ error: "Her kalemde postingNumber ve offerId gerekli" }, { status: 400 });
  }
  const reviewed = body.reviewed ?? true;

  const updated = await setShippingReviewed(items, reviewed);
  return NextResponse.json({ updated });
}
