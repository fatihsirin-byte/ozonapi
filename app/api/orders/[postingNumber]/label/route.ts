import { NextResponse } from "next/server";
import { OzonApiError } from "@/ozon/client";
import { fetchAndCacheLabel } from "@/ozon/labelCache";

// Ozon'un kargo etiketi (barkodlu PDF) endpoint'i — ÖNCE diskteki önbelleğe bakıyor (bkz.
// src/ozon/labelCache.ts), yoksa Ozon'dan çekip kaydediyor. Eskiden HER tıklamada canlı Ozon
// isteği atılıyordu, bu da 4-5 saniye sürüyordu (2026-09-23, kullanıcı bulgusu) — arka plan
// backfill cron'u (sync-orders-cron.ts) sayesinde çoğu sipariş sayfaya gelindiğinde zaten
// önbelleğe alınmış oluyor.
export async function GET(_request: Request, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const decoded = decodeURIComponent(postingNumber);

  try {
    const pdf = await fetchAndCacheLabel(decoded);
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
