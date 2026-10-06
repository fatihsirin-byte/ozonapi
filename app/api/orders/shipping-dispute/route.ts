import { NextRequest, NextResponse } from "next/server";
import { markOrdersDisputed } from "@/modules/finance/shipping-dispute.service";

// Finans Mütabakatı sayfasındaki "Tümünü İtiraz Edildi İşaretle" butonu bunu kullanır — o anki
// gerçek kargo tutarını baseline olarak dondurup siparişi "disputed" durumuna geçirir (bkz.
// shipping-dispute.service.ts markOrdersDisputed).
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { postingNumbers?: string[] };
  const postingNumbers = body.postingNumbers;
  if (!Array.isArray(postingNumbers) || postingNumbers.length === 0) {
    return NextResponse.json({ error: "postingNumbers boş olamaz" }, { status: 400 });
  }

  const updated = await markOrdersDisputed(postingNumbers);
  return NextResponse.json({ updated });
}
