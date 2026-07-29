import { NextRequest, NextResponse } from "next/server";
import { getProductAttributes } from "@/ozon/products";
import { findCategory } from "@/ozon/category-cache";
import { OzonApiError } from "@/ozon/client";

const MODEL_NAME_ATTRIBUTE_ID = 9048;

function mmToCm(value: number, unit: string): number {
  if (unit === "mm") return Math.round(value / 10);
  if (unit === "cm") return value;
  if (unit === "m") return Math.round(value * 100);
  return value;
}

// "Bu üründen kopyala" — Ozon'daki mevcut ürünün kategori/attribute/boyut/görsel bilgisini
// çekip yeni ürün wizard'ını önceden doldurmak için kullanılır.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;

  try {
    const { result } = await getProductAttributes([offerId]);
    const item = result[0];
    if (!item) {
      return NextResponse.json({ error: "Ürün Ozon'da bulunamadı" }, { status: 404 });
    }

    const category = await findCategory(item.description_category_id, item.type_id);

    return NextResponse.json({
      name: item.name,
      images: item.images,
      weightGrams: item.weight,
      widthCm: mmToCm(item.width, item.dimension_unit),
      heightCm: mmToCm(item.height, item.dimension_unit),
      depthCm: mmToCm(item.depth, item.dimension_unit),
      category: category ?? {
        descriptionCategoryId: item.description_category_id,
        typeId: item.type_id,
        path: "",
        typeName: "",
      },
      attributes: item.attributes
        .filter((attr) => attr.id !== MODEL_NAME_ATTRIBUTE_ID)
        .map((attr) => ({
          id: attr.id,
          dictionaryValueId: attr.values[0]?.dictionary_value_id || undefined,
          value: attr.values[0]?.dictionary_value_id ? undefined : attr.values[0]?.value,
        })),
    });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    throw error;
  }
}
