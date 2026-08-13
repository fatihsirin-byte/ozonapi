import { NextRequest, NextResponse } from "next/server";
import { createProduct, listAllProducts, listProductsPage, type CreateProductInput } from "@/modules/products/products.service";
import { getProductInfoList } from "@/ozon/products";
import { OzonApiError } from "@/ozon/client";

// ?q=&page=&pageSize= verilirse (Fiyat sayfası) aranabilir/sayfalı liste döner; hiçbiri
// verilmezse (Ürünler sayfasının eski davranışı) tüm ürünler tek seferde döner.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = searchParams.get("page");
  const pageSize = searchParams.get("pageSize");
  const q = searchParams.get("q");

  if (page || pageSize || q) {
    const result = await listProductsPage(Number(page) || 1, Number(pageSize) || 25, { q: q ?? undefined });

    // Fiyat rekabet endeksi — Ozon'un kendi ürün bilgisi uç noktasında zaten hesaplanmış geliyor
    // (color_index: GREEN/YELLOW/RED/WITHOUT_INDEX + rakiplerin gördüğü en düşük fiyat), biz kendi
    // hesap yapmıyoruz (para birimi karışıklığı riski olur — bkz. PNL RUB hatası). 2026-08-14,
    // kullanıcı talebi. Tek bir ürün Ozon'a hiç gönderilmemişse (henüz ozonProductId yok) atlanır.
    try {
      const offerIds = result.items.map((i) => i.offerId);
      if (offerIds.length > 0) {
        const { items: ozonItems } = await getProductInfoList(offerIds);
        const priceIndexByOfferId = new Map(
          (ozonItems as any[]).map((it) => [it.offer_id, it.price_indexes]),
        );
        result.items = result.items.map((i) => ({ ...i, priceIndex: priceIndexByOfferId.get(i.offerId) ?? null }));
      }
    } catch {
      // Ozon'dan rekabet endeksi çekilemezse (geçici hata vb.) liste yine de görünsün, sadece
      // endeks rozeti olmadan.
    }

    return NextResponse.json(result);
  }

  const products = await listAllProducts();
  // importTaskId BigInt — JSON.stringify edilemiyor, string'e çevirip dönüyoruz.
  const serialized = products.map((p) => ({ ...p, importTaskId: p.importTaskId?.toString() ?? null }));
  return NextResponse.json({ products: serialized });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CreateProductInput;

  try {
    const { taskId } = await createProduct(body);
    return NextResponse.json({ taskId });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    throw error;
  }
}
