import { NextRequest, NextResponse } from "next/server";
import { createCascadeVariant } from "@/modules/products/staging.service";

// Bir taban varyanttan yeni bir "toplu paket" (Box/Display) varyantı türetir (bkz. cascade
// sistemi — costPrice/weightGrams taban × unitsInPack olarak otomatik hesaplanır).
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { baseOfferId: string; unitsInPack: number; name?: string };

  if (!body.baseOfferId || !body.unitsInPack) {
    return NextResponse.json({ error: "Taban varyant ve adet zorunlu" }, { status: 400 });
  }

  try {
    const product = await createCascadeVariant(body);
    return NextResponse.json({ product: { ...product, importTaskId: product.importTaskId?.toString() ?? null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Varyant oluşturulamadı";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
