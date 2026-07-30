import { NextRequest, NextResponse } from "next/server";
import { getHandleGroup, updateDraftImages } from "@/modules/products/staging.service";

// importTaskId BigInt — JSON.stringify edilemiyor (Ozon'a gönderilmiş varyantlarda dolu
// oluyor), string'e çevirip dönüyoruz. Aksi halde bu route submitted ürünlerde 500 atıp
// sayfayı sonsuza kadar "Yükleniyor..." durumunda bırakıyordu. modelGroup.products da
// (başka handle'lardan gelen) tam Product satırları içerdiği için o da aynı riski taşıyor.
function serializeVariants(variants: Awaited<ReturnType<typeof getHandleGroup>>) {
  return variants.map((v) => ({
    ...v,
    importTaskId: v.importTaskId?.toString() ?? null,
    modelGroup: v.modelGroup && {
      ...v.modelGroup,
      products: v.modelGroup.products.map((p) => ({ ...p, importTaskId: p.importTaskId?.toString() ?? null })),
    },
  }));
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const variants = await getHandleGroup(decodeURIComponent(handle));
  if (variants.length === 0) {
    return NextResponse.json({ error: "Handle bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ variants: serializeVariants(variants) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const { images } = (await request.json()) as { images?: string[] };
  if (images === undefined) {
    return NextResponse.json({ error: "images gerekli" }, { status: 400 });
  }
  await updateDraftImages(decodeURIComponent(handle), images);
  const variants = await getHandleGroup(decodeURIComponent(handle));
  return NextResponse.json({ variants: serializeVariants(variants) });
}
