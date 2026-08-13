import { NextResponse } from "next/server";
import { listActions } from "@/ozon/actions";
import { OzonApiError } from "@/ozon/client";

export async function GET() {
  try {
    const { result } = await listActions();
    return NextResponse.json({ actions: result });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Aksiyonlar alınamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
