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
    // Ozon'un etiket API'si sadece sipariş "paketlenip kargoya hazır" (awaiting_deliver)
    // durumundayken çalışıyor — daha erken (awaiting_packaging) ya da daha geç (delivering,
    // delivered) denenirse "INVALID_ARGUMENT" ile reddediyor (2026-09-10'da canlıda test edilerek
    // doğrulandı, bkz. src/ozon/client.ts'teki hata mesajı düzeltmesi). Bu bizim tarafımızdan bir
    // hata değil, Ozon'un kendi kısıtı — kullanıcıya anlaşılır şekilde açıklıyoruz.
    const message =
      error instanceof OzonApiError && error.message === "INVALID_ARGUMENT"
        ? "Ozon bu sipariş için henüz etiket vermiyor — etiket sadece sipariş paketlenip kargoya hazır (awaiting_deliver) durumundayken alınabiliyor."
        : error instanceof OzonApiError
          ? error.message
          : "Etiket alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
