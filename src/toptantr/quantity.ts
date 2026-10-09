import type { Product } from "@prisma/client";
import { usdToTl } from "./pricing";

// toptantr sadece bu 4 sabit kombinasyon tipini kabul ediyor (Ürün Kombinasyon Değerleri servisi).
export const TOPTANTR_COMBINATION_TIERS = [
  { id: 1, name: "Adet" },
  { id: 2, name: "Paket" },
  { id: 3, name: "Koli" },
  { id: 4, name: "Palet" },
] as const;

export type TierName = (typeof TOPTANTR_COMBINATION_TIERS)[number]["name"];

// Kademe ekstra marjı kaldırıldı: tüm kademeler maliyet × %10 (bkz. pricing.ts).

// "Tekli" (1 adet) Adet-kademesi varyantlar toptantr'a gönderilmez — toptantr toptan pazaryeri,
// tekil parça satışı için değil — MECAZ hariç: tek başına zaten 1kg+ olan bir çuval/torba (unitsInPack
// yoksa/1'se ama ağırlığı büyükse) gerçek bir toptan birimidir, "tekli" perakende parçası değil.
const TEKLI_EXEMPT_MIN_KG = 1;

export function barcodeOf(product: Pick<Product, "barcode" | "offerId">): string {
  return product.barcode?.trim() || product.offerId.trim();
}

function weightInKg(product: Pick<Product, "weightGrams">): number {
  if (!product.weightGrams) return 0.1;
  return Math.round((product.weightGrams / 1000) * 1000) / 1000;
}

export function isTierSendable(tierName: TierName, product: Pick<Product, "weightGrams">): boolean {
  if (tierName !== "Adet") return true;
  return weightInKg(product) >= TEKLI_EXEMPT_MIN_KG;
}

export interface RankedVariant {
  product: Product;
  quantity: number;
  attributeId: number;
  attributeName: TierName;
}

// Varyantları SADECE paket adedine (unitsInPack) göre küçükten büyüğe sıralayıp toptantr'ın sabit
// kademelerine (Adet/Paket/Koli/Palet) sırayla atar — anahtar kelime eşleşmesi DEĞİL, sıralama
// bazlı bir atama (VPS'teki orijinal projeyle aynı yaklaşım). toptantr'ın 5. bir kademesi
// olmadığından ilk 4 varyant dışındakiler atlanır.
export function rankVariants(products: Product[]): RankedVariant[] {
  const sorted = [...products].sort((a, b) => (a.unitsInPack ?? 1) - (b.unitsInPack ?? 1));
  return sorted.slice(0, TOPTANTR_COMBINATION_TIERS.length).map((product, i) => ({
    product,
    quantity: product.unitsInPack ?? 1,
    attributeId: TOPTANTR_COMBINATION_TIERS[i].id,
    attributeName: TOPTANTR_COMBINATION_TIERS[i].name,
  }));
}

export function isSingleUnitOnlyHandle(products: Product[]): boolean {
  if (products.length !== 1) return false;
  return (products[0].unitsInPack ?? 1) <= 1 && weightInKg(products[0]) < TEKLI_EXEMPT_MIN_KG;
}

export interface VariantTierView {
  tier: TierName;
  itemPerPackage: number;
  sku: string;
  barcode: string;
  stockAvailable: number;
  stockOverride: number | null;
  costUsd: number;
  sellingPriceTl: number;
  sendable: boolean;
  approved: boolean;
}

// Varyantın kendi shopifyStock'u varsa o kullanılır; yoksa Adet kademesinin stoğu gerçek sayımı yansıtıyor (Ozon'a hep tekli
// gönderildiği için) — Paket/Koli/Palet kendi stockQuantity'sini hiç saymıyor, paylaşımlı
// fiziksel havuzdan floor(Adet stok / unitsInPack) ile türetiliyor. Güvenlik payı yok, tam
// floor değeri kullanılıyor (kullanıcı kararı, bkz. handoff notu).
//
// İSTİSNA: Product.toptantrStockOverride doluysa (elle kademe stoğu — Shopify'da sadece tekli
// stokluyken Display/Box'ı kullanıcı elle belirliyor) o değer kullanılır; ama tekli (Adet) stoğu
// 0 ise override'lı kademeler de 0'a düşer (kullanıcı kararı, 2026-10-06).
export function computeTierStock(ranked: RankedVariant[]): Map<string, number> {
  const adet = ranked.find((r) => r.attributeName === "Adet");
  // Adet taban stoğu: Shopify stoğu (shopifyStock) esas; hiç senkronlanmamışsa eski stockQuantity'ye düş.
  const adetStock = adet?.product.shopifyStock ?? adet?.product.stockQuantity ?? 0;
  const stockBySku = new Map<string, number>();
  for (const r of ranked) {
    const override = r.product.toptantrStockOverride;
    if (r.attributeName === "Adet") {
      stockBySku.set(r.product.offerId, adetStock);
    } else if (override !== null && override !== undefined) {
      stockBySku.set(r.product.offerId, adetStock > 0 ? override : 0);
    } else if (r.product.shopifyStock !== null && r.product.shopifyStock !== undefined) {
      // Karar: varyantın KENDİ Shopify stoğu varsa (Koli/Paket Shopify'da ayrı sayılıyorsa) o gerçek
      // sayımdır, Adet'ten türetilen tahminin önüne geçer.
      stockBySku.set(r.product.offerId, Math.max(0, r.product.shopifyStock));
    } else {
      const qty = r.quantity || 1;
      stockBySku.set(r.product.offerId, Math.floor(adetStock / qty));
    }
  }
  return stockBySku;
}

export function describeVariants(ranked: RankedVariant[], stockBySku: Map<string, number>): VariantTierView[] {
  return ranked.map(({ product, quantity, attributeName }) => ({
    tier: attributeName,
    itemPerPackage: quantity,
    sku: product.offerId,
    barcode: barcodeOf(product),
    stockAvailable: stockBySku.get(product.offerId) ?? 0,
    stockOverride: product.toptantrStockOverride ?? null,
    costUsd: Number(product.costPrice ?? 0),
    sellingPriceTl: usdToTl(product.costPrice),
    sendable: isTierSendable(attributeName, product),
    approved: product.toptantrApproved,
  }));
}

// Büyük kademe küçükten daha pahalıya (birim başına) gelmemeli — Koli'nin birim fiyatı Adet'ten
// yüksekse bu genelde alttaki Shopify maliyet verisinin paket boyutlarına orantılı ölçeklenmediğine
// işaret eder, elle kontrol edilmeli.
export function hasPriceAnomaly(variants: VariantTierView[]): boolean {
  const order: TierName[] = ["Adet", "Paket", "Koli", "Palet"];
  const present = order.map((t) => variants.find((v) => v.tier === t)).filter((v): v is VariantTierView => Boolean(v));
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const smaller = present[i];
      const bigger = present[j];
      if (!smaller.itemPerPackage || !bigger.itemPerPackage) continue;
      if (!smaller.sendable || !bigger.sendable) continue;
      if (smaller.itemPerPackage === 1 && bigger.itemPerPackage === 1) continue;
      const unitSmaller = smaller.sellingPriceTl / smaller.itemPerPackage;
      const unitBigger = bigger.sellingPriceTl / bigger.itemPerPackage;
      if (unitBigger > unitSmaller) return true;
    }
  }
  return false;
}

export { weightInKg };
