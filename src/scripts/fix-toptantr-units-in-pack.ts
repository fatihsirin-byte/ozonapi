// toptantr kombinasyonlarındaki itemPerPackage ile DB'deki Product.unitsInPack farkını listeler.
// Varsayılan DRY-RUN; --apply ile SADECE DB unitsInPack düzeltilir (toptantr'a yazılmaz).
//   npx tsx src/scripts/fix-toptantr-units-in-pack.ts [--apply]
import { prisma } from "../db/prisma";
import { lookupToptantr, combosOf, num } from "./_lib/toptantr-common";
import { rankVariants } from "../toptantr/quantity";
import { barcodeOf } from "../toptantr/quantity";
import { parseManualTiers } from "../toptantr/manualTiers";

async function main() {
  const apply = process.argv.includes("--apply");
  const listings = await prisma.toptantrListing.findMany({ where: { toptantrProductId: { not: null } } });
  console.log(`${apply ? "APPLY" : "DRY-RUN"} — ${listings.length} bağlı listing taranıyor`);
  let diffs = 0;
  for (const l of listings) {
    // Elle kademeli listing'lerde kademe adetleri DB varyantı değil elle girilen değerdir — atla.
    if (parseManualTiers(l.manualTiers).length > 0) continue;
    try {
      const { products, found } = await lookupToptantr(l.shopifyHandle, l.toptantrBarcode, l.toptantrProductId);
      if (!found) { console.log(`[YOK] ${l.shopifyHandle}: toptantr'da bulunamadı`); continue; }
      // Kademe -> DB varyantı: mevcut sıralama mantığıyla (rankVariants), kademe attribute id'sine göre.
      const ranked = rankVariants(products);
      for (const c of combosOf(found)) {
        const ipp = num(c.itemPerPackage);
        const tierAttr = (c.attributes ?? [])[0];
        // Önce kombinasyon barkodu ile, yoksa kademe attribute id'si ile eşleştir.
        const cb = typeof c.barcode === "string" ? c.barcode.trim() : "";
        const r = (cb && ranked.find((x) => barcodeOf(x.product) === cb)) || ranked.find((x) => x.attributeId === tierAttr?.id);
        if (ipp === null || !r) continue;
        const dbVal = r.product.unitsInPack ?? null;
        if (dbVal !== ipp) {
          diffs++;
          console.log(`FARK ${l.shopifyHandle} [${tierAttr?.name}] sku=${r.product.offerId} DB=${dbVal} toptantr=${ipp}`);
          if (apply) await prisma.product.update({ where: { id: r.product.id }, data: { unitsInPack: ipp } });
        }
      }
    } catch (e) {
      console.log(`[HATA] ${l.shopifyHandle}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Toplam fark: ${diffs}${apply ? " (DB güncellendi)" : " (dry-run, yazılmadı)"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
