// Shopify'da ARCHIVED/DRAFT olan ürünlerin toptantr'daki aktif (status=success) listing'lerini listeler.
// Varsayılan DRY-RUN; --apply ile toptantr stokları 0'a çekilir ve listing draft'a alınır.
// Bir handle'ın TÜM Shopify varyantları ACTIVE değilse (hiç ACTIVE yoksa) kapatılır.
//   npx tsx src/scripts/close-toptantr-archived.ts [--apply]
import { prisma } from "../db/prisma";
import { fetchShopifyStockByLocation } from "../shopify/inventory";
import { lookupToptantr, combosOf, comboStock, closeListing } from "./_lib/toptantr-common";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`${apply ? "APPLY" : "DRY-RUN"} — Shopify durumları çekiliyor...`);
  const rows = await fetchShopifyStockByLocation();
  const statusByHandle = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.productHandle) continue;
    const set = statusByHandle.get(r.productHandle) ?? new Set<string>();
    set.add(r.productStatus);
    statusByHandle.set(r.productHandle, set);
  }
  const listings = await prisma.toptantrListing.findMany({ where: { status: "success", toptantrProductId: { not: null } } });
  console.log(`${listings.length} aktif listing`);
  let n = 0;
  for (const l of listings) {
    const st = statusByHandle.get(l.shopifyHandle);
    if (!st) { console.log(`[?] ${l.shopifyHandle}: Shopify'da bulunamadı (atlandı)`); continue; }
    if (st.has("ACTIVE")) continue;
    n++;
    const label = [...st].join("/");
    try {
      const { found } = await lookupToptantr(l.shopifyHandle, l.toptantrBarcode);
      const stocks = combosOf(found).map((c) => comboStock(c));
      console.log(`KAPATILACAK ${l.shopifyHandle} shopify=${label} toptantrId=${l.toptantrProductId} kombinasyon=${combosOf(found).length} stoklar=${JSON.stringify(stocks)}`);
      if (apply) console.log(`  -> ${await closeListing(l.shopifyHandle, found, `Shopify ${label}`)} kombinasyon 0'landı`);
    } catch (e) {
      console.log(`[HATA] ${l.shopifyHandle}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Toplam: ${n}${apply ? " (kapatıldı)" : " (dry-run, yazılmadı)"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
