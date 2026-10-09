import { NextRequest, NextResponse } from "next/server";
import { saveManualTiers } from "@/modules/toptantr/toptantr.service";

// Elle kademe (Paket/Koli) kaydeder — boş liste elle kademeyi kaldırır.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const body = (await request.json().catch(() => ({}))) as { tiers?: unknown };
  try {
    const tiers = await saveManualTiers(handle, body.tiers ?? []);
    return NextResponse.json({ tiers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
