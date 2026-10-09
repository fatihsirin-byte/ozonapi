import { NextRequest, NextResponse } from "next/server";
import { generateToptantrText, saveToptantrText } from "@/modules/toptantr/toptantr.service";

// POST: Gemini ile Türkçe başlık/açıklama üretir ve kaydeder (toptantr'a göndermez).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  try {
    return NextResponse.json(await generateToptantrText(handle));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// PUT: düzenlenmiş metni kaydeder; push:true ise (ürün bağlıysa) toptantr'a da gönderir.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const body = (await request.json().catch(() => ({}))) as { title?: string; shortDescription?: string; fullDescription?: string; push?: boolean };
  try {
    await saveToptantrText(handle, { title: body.title ?? "", shortDescription: body.shortDescription ?? "", fullDescription: body.fullDescription ?? "" }, Boolean(body.push));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
