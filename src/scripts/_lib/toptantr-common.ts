// toptantr script'leri için ortak yardımcılar (client.ts'e dokunmadan, mevcut fonksiyonlarla).
import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import { findProductByBarcode, updateCombinations } from "../../toptantr/client";
import { barcodeOf } from "../../toptantr/quantity";

export type RawCombination = Record<string, unknown> & { id: string; attributes?: { id: number; name: string }[] };

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// toptantr'daki ürünü bulur: önce kayıtlı toptantrBarcode, yoksa handle'ın ilk varyantının barkodu.
export async function lookupToptantr(handle: string, toptantrBarcode: string | null, toptantrProductId?: string | null) {
  const products = await prisma.product.findMany({ where: { shopifyHandle: handle }, orderBy: { variantPosition: "asc" } });
  // Kayıtlı barkod, yoksa tüm varyant barkodları/SKU'ları sırayla denenir (ilk bulunan döner).
  // ID biliniyorsa doğrudan ID ile bul (barkod aramaları toptantr'da sonuç vermiyor, bkz. client.ts).
  if (toptantrProductId) {
    const byId = await findProductByBarcode(null, { productId: toptantrProductId });
    if (byId) return { products, barcode: toptantrBarcode, found: byId };
  }
  const candidates = [...new Set([toptantrBarcode, ...products.map(barcodeOf), ...products.map((p) => p.offerId.trim())].filter((x): x is string => !!x))];
  for (const barcode of candidates) {
    const found = await findProductByBarcode(barcode, { productId: toptantrProductId ?? undefined });
    if (found) return { products, barcode, found };
  }
  return { products, barcode: candidates[0] ?? null, found: null };
}

export function combosOf(found: { productAttributeCombinations?: unknown[] } | null): RawCombination[] {
  return ((found?.productAttributeCombinations ?? []) as RawCombination[]);
}

// Kombinasyonun mevcut stok değeri (alan adı API'den API'ye değişebilir; bilinen adaylar denenir).
export function comboStock(c: RawCombination): number | null {
  return num(c.stockQuantity) ?? num(c.quantity);
}

// "Kapatma" = toptantr'da tüm kombinasyonların stoğunu 0'a çekmek + DB'de listing'i draft'a almak
// (draft'a alınca stok senkronu/refresh tekrar açmaz; refresh sadece status=success'e çalışır).
export async function closeListing(handle: string, found: { productAttributeCombinations?: unknown[] } | null, reason: string) {
  const combos = combosOf(found);
  const updates = combos.map((c) => ({
    id: c.id,
    quantity: 0,
    taxCategory: num(c.taxCategory) ?? env.toptantrDefaultTaxCategory,
    sellingPrice: num(c.overriddenPrice) ?? num(c.sellingPrice) ?? 0, // fiyat korunur, sadece stok 0'lanır
  }));
  if (updates.length > 0) await updateCombinations(updates);
  await prisma.toptantrListing.update({ where: { shopifyHandle: handle }, data: { status: "draft", lastError: `Kapatıldı: ${reason}` } });
  return updates.length;
}
