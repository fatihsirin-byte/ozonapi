import { NextResponse } from "next/server";
import { listActions } from "@/ozon/actions";
import { translateActionTitle } from "@/ai/translate";
import { OzonApiError } from "@/ozon/client";

// Aynı sınıftan bir hatanın (bkz. app/api/aladdin-invoice/route.ts yorumu) tekrarlanmaması için —
// bu GET de hiçbir dinamik Next.js API'si kullanmıyor, `force-dynamic` olmadan Ozon'daki kampanya
// listesi build anında donup kalabilirdi.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { result } = await listActions();
    // Ozon aksiyon başlıkları Rusça geliyor — okunur olması için Türkçe'ye çeviriyoruz
    // (çeviri başarısız olursa translateActionTitle orijinali döner, sayfa yine çalışır).
    const actions = await Promise.all(
      result.map(async (a) => ({ ...a, title: await translateActionTitle(a.title) })),
    );
    return NextResponse.json({ actions });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Aksiyonlar alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
