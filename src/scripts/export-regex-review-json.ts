// unitsInPack backfill-units-in-pack-regex.ts ile regex'ten türetilen 852 ürünü (offerId, name,
// shopifyHandle, regex değeri) JSON olarak dışa aktarır. Kullanıcının bunları elle gözden
// geçirip gerçek kutu-içi değerlerle karşılaştırabileceği bir review sayfası için kaynak veri.
// Salt-okunur, DB'ye hiçbir şey yazmaz.
import { prisma } from "../db/prisma";
import { extractPackQuantity } from "../import/pack-quantity";
import { writeFileSync } from "fs";

async function main() {
  const allWithHandle = await prisma.product.findMany({
    where: { shopifyHandle: { not: null } },
    select: { offerId: true, shopifyHandle: true },
  });
  const handleCounts = new Map<string, number>();
  for (const p of allWithHandle) handleCounts.set(p.shopifyHandle!, (handleCounts.get(p.shopifyHandle!) ?? 0) + 1);
  const multiVariantHandles = new Set([...handleCounts.entries()].filter(([, c]) => c > 1).map(([h]) => h));

  const candidates = await prisma.product.findMany({
    where: { shopifyHandle: { not: null } },
    select: { offerId: true, name: true, shopifyHandle: true, unitsInPack: true },
    orderBy: [{ shopifyHandle: "asc" }],
  });
  const products = candidates.filter((p) => multiVariantHandles.has(p.shopifyHandle!));

  const rows: { offerId: string; name: string; handle: string; regexValue: number }[] = [];
  for (const p of products) {
    const units = extractPackQuantity(p.name);
    if (units && units > 0) {
      rows.push({ offerId: p.offerId, name: p.name, handle: p.shopifyHandle!, regexValue: units });
    }
  }

  console.log(`[export] ${rows.length} satır bulundu`);
  writeFileSync("/tmp/regex-review.json", JSON.stringify(rows, null, 2));
  console.log("[export] /tmp/regex-review.json yazıldı");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
