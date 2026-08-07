import { NextRequest, NextResponse } from "next/server";
import {
  getProduct,
  updateProductPrice,
  updateProductImages,
  updateProductCategoryAttributes,
  updateProductHeavyPackaging,
  updateProductWeight,
  type ProductAttributeInput,
} from "@/modules/products/products.service";
import { OzonApiError } from "@/ozon/client";

// importTaskId BigInt — JSON.stringify edilemiyor, string'e çevirip dönüyoruz.
function serializeProduct(product: NonNullable<Awaited<ReturnType<typeof getProduct>>>) {
  return { ...product, importTaskId: product.importTaskId?.toString() ?? null };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const product = await getProduct(offerId);
  if (!product) {
    return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ product: serializeProduct(product) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const body = (await request.json()) as {
    costPrice?: string;
    priceOverride?: string;
    heavyPackaging?: boolean;
    images?: string[];
    category?: { descriptionCategoryId: number; typeId: number };
    attributes?: ProductAttributeInput[];
    weightGrams?: number | null;
    cargoWeightGrams?: number | null;
    widthCm?: number | null;
    heightCm?: number | null;
    depthCm?: number | null;
  };

  try {
    if (body.heavyPackaging !== undefined) {
      await updateProductHeavyPackaging(offerId, body.heavyPackaging);
    }
    if (
      body.weightGrams !== undefined ||
      body.cargoWeightGrams !== undefined ||
      body.widthCm !== undefined ||
      body.heightCm !== undefined ||
      body.depthCm !== undefined
    ) {
      await updateProductWeight(offerId, {
        weightGrams: body.weightGrams,
        cargoWeightGrams: body.cargoWeightGrams,
        widthCm: body.widthCm,
        heightCm: body.heightCm,
        depthCm: body.depthCm,
      });
    }
    if (body.costPrice !== undefined) {
      await updateProductPrice(offerId, body.costPrice, body.priceOverride);
    }
    if (body.images !== undefined) {
      await updateProductImages(offerId, body.images);
    }
    if (body.category !== undefined) {
      await updateProductCategoryAttributes(offerId, {
        descriptionCategoryId: body.category.descriptionCategoryId,
        typeId: body.category.typeId,
        attributes: body.attributes ?? [],
      });
    }
    const product = await getProduct(offerId);
    return NextResponse.json({ product: product ? serializeProduct(product) : null });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
