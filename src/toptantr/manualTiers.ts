import type { Product } from "@prisma/client";
import { TOPTANTR_COMBINATION_TIERS, type RankedVariant, type TierName } from "./quantity";

// Elle girilen kademeler SADECE toptantr'ın sabit adlarından ikisi olabilir: Paket (kutu/display) ve
// Koli — kafaya göre kademe adı yok (kullanıcı kararı, 2026-10-09).
export const MANUAL_TIER_NAMES = ["Paket", "Koli"] as const;
export type ManualTierName = (typeof MANUAL_TIER_NAMES)[number];

export interface ManualTier {
  tier: ManualTierName;
  itemPerPackage: number;
  stock: number;
}

export function parseManualTiers(raw: unknown): ManualTier[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is ManualTier =>
      t && typeof t === "object" && MANUAL_TIER_NAMES.includes((t as ManualTier).tier) && Number.isInteger((t as ManualTier).itemPerPackage) && Number.isInteger((t as ManualTier).stock),
  );
}

// Girdiyi doğrular; hata varsa Türkçe mesajla fırlatır.
export function validateManualTiers(input: unknown): ManualTier[] {
  if (!Array.isArray(input)) throw new Error("Kademeler liste olmalı");
  const tiers: ManualTier[] = input.map((t) => ({
    tier: (t as ManualTier)?.tier,
    itemPerPackage: Number((t as ManualTier)?.itemPerPackage),
    stock: Number((t as ManualTier)?.stock),
  }));
  const seen = new Set<string>();
  for (const t of tiers) {
    if (!MANUAL_TIER_NAMES.includes(t.tier)) throw new Error("Kademe sadece Paket veya Koli olabilir");
    if (seen.has(t.tier)) throw new Error(`${t.tier} kademesi birden fazla girilmiş`);
    seen.add(t.tier);
    if (!Number.isInteger(t.itemPerPackage) || t.itemPerPackage < 2) throw new Error(`${t.tier}: paket içi adet 2 veya daha büyük tam sayı olmalı`);
    if (!Number.isInteger(t.stock) || t.stock < 0) throw new Error(`${t.tier}: stok 0 veya pozitif tam sayı olmalı`);
  }
  const paket = tiers.find((t) => t.tier === "Paket");
  const koli = tiers.find((t) => t.tier === "Koli");
  if (paket && koli && paket.itemPerPackage >= koli.itemPerPackage) throw new Error("Koli içindeki adet, Paket içindeki adetten büyük olmalı");
  return tiers;
}

// Elle kademeleri, mevcut gönderim akışının (buildPayload/pushStockAndPrice) beklediği şekle çevirir:
// taban (tekli) ürünün kopyası üzerinden sentetik varyantlar. Barkod: taban barkod + kademe eki
// (toptantr kombinasyon barkodları benzersiz olmalı). Maliyet ve ağırlık paket içi adetle çarpılır.
export function buildManualRanked(base: Product, tiers: ManualTier[]): { ranked: RankedVariant[]; stockBySku: Map<string, number> } {
  const baseBarcode = (base.barcode?.trim() || base.offerId.trim());
  const unitCost = parseFloat(base.costPrice ?? "0") || 0;
  const sorted = [...tiers].sort((a, b) => a.itemPerPackage - b.itemPerPackage);
  const stockBySku = new Map<string, number>();
  const ranked: RankedVariant[] = sorted.map((t) => {
    const tierDef = TOPTANTR_COMBINATION_TIERS.find((x) => x.name === t.tier)!;
    const offerId = `${base.offerId}#${t.tier}`;
    const product: Product = {
      ...base,
      offerId,
      barcode: `${baseBarcode}-${t.tier.toUpperCase()}${t.itemPerPackage}`,
      costPrice: String(Math.round(unitCost * t.itemPerPackage * 100) / 100),
      weightGrams: base.weightGrams ? base.weightGrams * t.itemPerPackage : null,
      unitsInPack: t.itemPerPackage,
    };
    stockBySku.set(offerId, t.stock);
    return { product, quantity: t.itemPerPackage, attributeId: tierDef.id, attributeName: t.tier as TierName };
  });
  return { ranked, stockBySku };
}
