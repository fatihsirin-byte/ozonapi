// Box/Display restore script'i sadece CSV'deki "Box/Display/Case" kelimesi geçen varyantları
// yakalıyordu — ama "5 Bars", "10 Bars" gibi sadece sayı+birim kelimesi içeren (Box/Display
// olmayan) varyantlar da aynı mantıkla bir taban varyantın katı. Bu script TÜM ürünleri (aktif/
// draft, restore geçmişinden bağımsız) handle bazında tarar, taban varyantı (en düşük ağırlıklı)
// bulur, diğer varyantların adını regex ile (ya da ağırlık oranıyla) tabana bağlar.
import { prisma } from "../db/prisma";
import { computeSalePrice } from "../pricing/formula";

const COMMIT = process.argv.includes("--commit");

const UNIT_WORDS = "pieces?|pcs?|bars?|packs?|cups?|bottles?|capsules?|sachets?|tablets?|sets?|servings?|boxes?|bags?|cans?";

function extractQtyFromName(name: string): number | null {
  const direct = name.match(new RegExp(`(\\d+)\\s*(?:${UNIT_WORDS})\\b`, "i"));
  if (direct) return Number(direct[1]);
  return null;
}

async function main() {
  const products = await prisma.product.findMany({
    where: { shopifyHandle: { not: null } },
    select: { offerId: true, name: true, weightGrams: true, costPrice: true, unitsInPack: true, packBaseOfferId: true, shopifyHandle: true },
  });

  const byHandle = new Map<string, typeof products>();
  for (const p of products) {
    const list = byHandle.get(p.shopifyHandle!) ?? [];
    list.push(p);
    byHandle.set(p.shopifyHandle!, list);
  }

  let linked = 0;
  let alreadyLinked = 0;
  const updates: Array<{ offerId: string; unitsInPack: number; packBaseOfferId: string; costPrice: string; weightGrams: number | null }> = [];
  const reviewSamples: string[] = [];

  for (const [handle, variants] of byHandle) {
    if (variants.length < 2) continue;
    alreadyLinked += variants.filter((v) => v.packBaseOfferId).length;

    const withWeight = variants.filter((v) => v.weightGrams && v.weightGrams > 0 && v.costPrice);
    if (withWeight.length < 2) continue;
    const base = withWeight.reduce((min, v) => (v.weightGrams! < min.weightGrams! ? v : min));

    for (const v of variants) {
      if (v.offerId === base.offerId) continue;
      if (v.packBaseOfferId) continue; // zaten bağlı
      if (!v.costPrice) continue;

      let qty = extractQtyFromName(v.name);
      if (!qty && v.weightGrams && base.weightGrams) {
        const ratio = v.weightGrams / base.weightGrams;
        const rounded = Math.round(ratio);
        if (rounded >= 2 && Math.abs(ratio - rounded) / rounded < 0.08) qty = rounded;
      }
      if (!qty || qty < 2) continue;

      const baseCost = Number(base.costPrice);
      const cascadeCost = baseCost * qty;
      const currentCost = Number(v.costPrice);
      const costPrice = (Math.abs(currentCost - cascadeCost) / cascadeCost < 0.2 ? currentCost : cascadeCost).toFixed(2);
      const weightGrams = v.weightGrams ?? (base.weightGrams ? base.weightGrams * qty : null);

      updates.push({ offerId: v.offerId, unitsInPack: qty, packBaseOfferId: base.offerId, costPrice, weightGrams });
      linked++;
      if (reviewSamples.length < 30) {
        reviewSamples.push(`${handle} | ${v.offerId} "${v.name}" -> adet=${qty} taban=${base.offerId} alış=$${costPrice}`);
      }
    }
  }

  console.log(`Zaten bağlı: ${alreadyLinked}, yeni bağlanacak: ${linked}`);
  reviewSamples.forEach((s) => console.log(" ", s));

  if (!COMMIT) {
    console.log("\nDRY RUN — DB'ye yazılmadı. --commit ile gerçek çalıştır.");
    return;
  }

  console.log("\nCOMMIT modunda, yazılıyor...");
  for (const u of updates) {
    const price = computeSalePrice(u.costPrice, u.weightGrams) || "0";
    await prisma.product.update({
      where: { offerId: u.offerId },
      data: { unitsInPack: u.unitsInPack, packBaseOfferId: u.packBaseOfferId, costPrice: u.costPrice, weightGrams: u.weightGrams, price },
    });
  }
  console.log(`Bitti, ${updates.length} varyant güncellendi.`);
}

main().finally(() => prisma.$disconnect());
