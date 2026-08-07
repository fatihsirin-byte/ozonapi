import { NextResponse } from "next/server";
import { getFbsPackageLabel } from "@/ozon/orders";
import { OzonApiError } from "@/ozon/client";

// Ozon'un kargo etiketi (barkodlu PDF) endpoint'i — doğrudan Ozon'dan çekip aynen döndürüyoruz,
// biz DB'de saklamıyoruz (her zaman canlıdan çekiliyor).
export async function GET(_request: Request, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const decoded = decodeURIComponent(postingNumber);

  try {
    const pdf = await getFbsPackageLabel(decoded);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${decoded}.pdf"`,
      },
    });
  } catch (error) {
    const message = error instanceof OzonApiError ? error.message : "Etiket alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
