import { prisma } from "../db/prisma";
import { fetchCategories, fetchBrands, type ToptantrCategory, type ToptantrBrand } from "./client";

const TTL_MS = 6 * 60 * 60 * 1000;

// Kategori/marka listesi büyük ve nadiren değişiyor — Ozon'un category-cache.ts'iyle aynı
// process-içi TTL cache deseni (VPS'teki orijinal proje bunu dosyaya yazıyordu, burada ozonapi
// zaten sürekli çalışan bir process olduğundan dosyaya gerek yok).
let categoriesCache: { items: ToptantrCategory[]; fetchedAt: number } | null = null;
let brandsCache: { items: ToptantrBrand[]; fetchedAt: number } | null = null;
let categoriesInflight: Promise<ToptantrCategory[]> | null = null;
let brandsInflight: Promise<ToptantrBrand[]> | null = null;

export async function getToptantrCategories({ refresh = false } = {}): Promise<ToptantrCategory[]> {
  if (!refresh && categoriesCache && Date.now() - categoriesCache.fetchedAt < TTL_MS) {
    return categoriesCache.items;
  }
  if (!categoriesInflight) {
    categoriesInflight = fetchCategories()
      .then((items) => {
        categoriesCache = { items, fetchedAt: Date.now() };
        return items;
      })
      .finally(() => {
        categoriesInflight = null;
      });
  }
  return categoriesInflight;
}

export async function getToptantrBrands({ refresh = false } = {}): Promise<ToptantrBrand[]> {
  if (!refresh && brandsCache && Date.now() - brandsCache.fetchedAt < TTL_MS) {
    return brandsCache.items;
  }
  if (!brandsInflight) {
    brandsInflight = fetchBrands()
      .then((items) => {
        brandsCache = { items, fetchedAt: Date.now() };
        return items;
      })
      .finally(() => {
        brandsInflight = null;
      });
  }
  return brandsInflight;
}

export function searchCategories(categories: ToptantrCategory[], query: string, limit = 20): ToptantrCategory[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return categories
    .filter((c) => (c.breadcrumb ?? c.name ?? "").toLowerCase().includes(normalized))
    .slice(0, limit);
}

export function searchBrands(brands: ToptantrBrand[], query: string, limit = 20): ToptantrBrand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return brands.filter((b) => b.name.toLowerCase().includes(normalized)).slice(0, limit);
}

function typeBrandKey(vendor: string | null | undefined, productType: string | null | undefined): string {
  return `${(vendor ?? "").trim().toLowerCase()}::${(productType ?? "").trim().toLowerCase()}`;
}

// (vendor, productType) çifti için daha önce seçilmiş kategori/marka varsa onu döner — Gemini'ye
// (veya kullanıcıya) her ürün için tekrar tekrar sormamak için (bkz. ToptantrListing kaydı da
// zaten handle bazlı ama bu cache vendor+type bazlı, farklı handle'lar aynı kombinasyonu paylaşabilir).
export async function getCachedMapping(
  vendor: string | null | undefined,
  productType: string | null | undefined,
): Promise<{ categoryGuid: string | null; brandGuid: string | null } | null> {
  const key = typeBrandKey(vendor, productType);
  const row = await prisma.toptantrMappingCache.findUnique({ where: { key } });
  if (!row) return null;
  return { categoryGuid: row.categoryGuid, brandGuid: row.brandGuid };
}

export async function setCachedMapping(
  vendor: string | null | undefined,
  productType: string | null | undefined,
  mapping: { categoryGuid: string | null; brandGuid: string | null },
): Promise<void> {
  const key = typeBrandKey(vendor, productType);
  await prisma.toptantrMappingCache.upsert({
    where: { key },
    create: { key, categoryGuid: mapping.categoryGuid, brandGuid: mapping.brandGuid },
    update: { categoryGuid: mapping.categoryGuid, brandGuid: mapping.brandGuid },
  });
}
