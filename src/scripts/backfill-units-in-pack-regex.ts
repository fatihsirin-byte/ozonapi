// Shopify'dan gelen tüm ürünlerde (shopifyHandle dolu — canlı katalog) unitsInPack'i, varyant
// adındaki İngilizce paket ifadelerinden (ör. "1 Box - 24 Pieces x 35g", "Pack of 12")
// extractPackQuantity() regex'iyle çıkarıp doldurur. SADECE unitsInPack NULL olan ürünlere
// yazar — hâlihazırda bir değeri olan ürünlere (elle/CSV ile girilmiş olabilir) DOKUNMAZ.
// Regex hiçbir şey bulamazsa o ürün atlanır (tahmin yürütülmez — "hata yapmamak önemli").
//
// GÜVENLİK KISITI: SADECE çok-varyantlı (aynı handle'da ≥2 ürün) handle'lara yazılır. Tek
// varyantlı handle'larda unitsInPack toptantr Koli/Paket/Palet tiering'ini zaten ETKİLEMİYOR
// (bkz. rankVariants) — ama isSingleUnitOnlyHandle "tekli perakende" istisnasını bozabilir
// (ör. tek SKU'luk "30 Tablets" içerikli bir şişe, unitsInPack=30 yazılırsa yanlışlıkla toptantr'a
// gönderilebilir hale gelir). Bu riski almamak için tekli handle'lar tamamen atlanıyor.
//
// Çalıştırma: npx tsx src/scripts/backfill-units-in-pack-regex.ts [--apply]
// --apply verilmezse DRY RUN (hiçbir şey yazılmaz, sadece rapor).
import { prisma } from "../db/prisma";
import { extractPackQuantity } from "../import/pack-quantity";

async function main() {
  const apply = process.argv.includes("--apply");

  const allWithHandle = await prisma.product.findMany({
    where: { shopifyHandle: { not: null } },
    select: { offerId: true, shopifyHandle: true },
  });
  const handleCounts = new Map<string, number>();
  for (const p of allWithHandle) handleCounts.set(p.shopifyHandle!, (handleCounts.get(p.shopifyHandle!) ?? 0) + 1);
  const multiVariantHandles = new Set([...handleCounts.entries()].filter(([, c]) => c > 1).map(([h]) => h));

  const nullUnits = await prisma.product.findMany({
    where: { shopifyHandle: { not: null }, unitsInPack: null },
    select: { offerId: true, name: true, shopifyHandle: true },
    orderBy: [{ shopifyHandle: "asc" }],
  });
  const products = nullUnits.filter((p) => multiVariantHandles.has(p.shopifyHandle!));
  const skippedSingleVariant = nullUnits.length - products.length;

  const matches: { offerId: string; name: string; units: number }[] = [];
  let noMatch = 0;
  for (const p of products) {
    const units = extractPackQuantity(p.name);
    if (units && units > 0) {
      matches.push({ offerId: p.offerId, name: p.name, units });
    } else {
      noMatch++;
    }
  }

  console.log(`[backfill] unitsInPack NULL olan ${nullUnits.length} üründen ${skippedSingleVariant} tanesi tek-varyantlı handle (atlandı), ${products.length} tanesi çok-varyantlı handle içinde tarandı`);
  console.log(`[backfill] regex ile bulundu: ${matches.length}, bulunamadı (atlandı): ${noMatch}`);

  if (!apply) {
    console.log("[backfill] DRY RUN — hiçbir şey yazılmadı. Uygulamak için --apply ekleyin.");
    for (const m of matches.slice(0, 40)) {
      console.log(`  ${m.offerId}: ${m.units}  (${m.name})`);
    }
    if (matches.length > 40) console.log(`  ... ve ${matches.length - 40} tane daha`);
    await prisma.$disconnect();
    return;
  }

  let applied = 0;
  for (const m of matches) {
    await prisma.product.update({ where: { offerId: m.offerId }, data: { unitsInPack: m.units } });
    applied++;
  }
  console.log(`[backfill] Uygulandı: ${applied}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
