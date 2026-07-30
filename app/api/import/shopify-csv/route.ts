import { NextRequest, NextResponse } from "next/server";
import { importShopifyCsvText } from "@/import/import-products";

const MAX_SIZE_BYTES = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file alanı gerekli" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json({ error: "Sadece .csv dosyası kabul edilir" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "CSV 50MB'tan büyük olamaz" }, { status: 400 });
  }

  const csvText = await file.text();

  try {
    const summary = await importShopifyCsvText(csvText);
    return NextResponse.json(summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : "CSV işlenemedi";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
