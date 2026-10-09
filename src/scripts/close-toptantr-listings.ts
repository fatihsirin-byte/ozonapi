// Verilen handle'ların toptantr listing'lerini kapatır (stok 0 + listing draft).
// Varsayılan DRY-RUN; --apply ile uygular.
//   npx tsx src/scripts/close-toptantr-listings.ts handle1 handle2 [--apply]
//   npx tsx src/scripts/close-toptantr-listings.ts --file handles.txt [--apply]   (satır başına bir handle)
import fs from "node:fs";
import { prisma } from "../db/prisma";
import { lookupToptantr, combosOf, comboStock, closeListing } from "./_lib/toptantr-common";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const handles: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") continue;
    if (args[i] === "--file") {
      handles.push(...fs.readFileSync(args[++i], "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    } else handles.push(args[i]);
  }
  if (handles.length === 0) { console.error("Handle verilmedi (argüman veya --file)"); process.exit(1); }
  console.log(`${apply ? "APPLY" : "DRY-RUN"} — ${handles.length} handle`);
  for (const h of handles) {
    const l = await prisma.toptantrListing.findUnique({ where: { shopifyHandle: h } });
    if (!l || !l.toptantrProductId) { console.log(`[YOK] ${h}: toptantr listing'i yok`); continue; }
    try {
      const { found } = await lookupToptantr(h, l.toptantrBarcode, l.toptantrProductId);
      console.log(`KAPATILACAK ${h} status=${l.status} kombinasyon=${combosOf(found).length} stoklar=${JSON.stringify(combosOf(found).map(comboStock))}`);
      if (apply) console.log(`  -> ${await closeListing(h, found, "elle kapatıldı")} kombinasyon 0'landı`);
    } catch (e) {
      console.log(`[HATA] ${h}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
