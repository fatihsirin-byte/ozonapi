// find-single-active-variant CSV'sindeki ürünlerde Ozon'a SADECE en düşük adetli (tekli) varyantı
// göndermek için diğer varyantları pasifler (excludedFromSubmit=true) ve Ozon'da zaten satıştaki
// (status != draft) pasiflenen varyantların stoğunu 0'a çeker. (2026-10-06, kullanıcı kararı)
//
//   npx tsx src/scripts/ozon-only-single-variant.ts tek-varyant-....csv           # dry-run
//   npx tsx src/scripts/ozon-only-single-variant.ts tek-varyant-....csv --apply   # yazar + Ozon'a stok 0
//
// Güvenlik: "tekli" kararı DB'deki unitsInPack'e DEĞİL, CSV'deki stoklu_adet ile bos_varyantlar'daki
// "[N adet]" değerlerine göre verilir (DB'de çoğu zaman iki varyantın unitsInPack'i eşit/boş, sıralama
// belirsiz oluyordu). Stoklu varyantın adedi, boş varyantların HEPSİNDEN kesin küçük değilse (eşit ya
// da bilinmiyorsa) handle atlanıp raporlanır. Sadece CSV'de boş listelenen SKU'lar pasiflenir.
// Handle DB'de yoksa atlanır. Zaten pasif olanlara dokunulmaz ama Ozon'da satıştaysa stok 0'lanır.
import fs from "node:fs";
import { prisma } from "../db/prisma";
import { updateStocks } from "../ozon/products";
import { selectWarehouseId } from "../ozon/warehouses";

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, ""), r[i] ?? ""])));
}

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!file || file.startsWith("--")) throw new Error("Kullanım: ozon-only-single-variant.ts dosya.csv [--apply]");

  const csv = parseCsv(fs.readFileSync(file, "utf8"));
  const handles = csv.map((r) => r.handle);
  const products = await prisma.product.findMany({
    where: { shopifyHandle: { in: handles } },
    select: {
      offerId: true,
      shopifyHandle: true,
      shopifyVariantId: true,
      unitsInPack: true,
      status: true,
      excludedFromSubmit: true,
      weightGrams: true,
      widthCm: true,
      heightCm: true,
      depthCm: true,
    },
  });
  const byHandle = new Map<string, typeof products>();
  for (const p of products) {
    const list = byHandle.get(p.shopifyHandle!) ?? [];
    list.push(p);
    byHandle.set(p.shopifyHandle!, list);
  }

  const toExclude: string[] = [];
  const zeroStock: typeof products = [];
  const skipped: string[] = [];
  for (const r of csv) {
    const variants = byHandle.get(r.handle);
    if (!variants?.length) {
      skipped.push(`${r.handle}: DB'de yok`);
      continue;
    }
    const stocked = variants.find((v) => v.offerId === r.stoklu_sku || v.shopifyVariantId === r.stoklu_sku);
    if (!stocked) {
      skipped.push(`${r.handle}: stoklu varyant (${r.stoklu_sku}) DB'de yok`);
      continue;
    }
    const stockedUnits = Number(r.stoklu_adet);
    const empties = [...r.bos_varyantlar.matchAll(/\[(\d+|\?)\s*adet\]\s*\(([^()]*)\)\s*(?:\||$)/g)].map((m) => ({
      units: m[1] === "?" ? NaN : Number(m[1]),
      sku: m[2],
    }));
    if (!stockedUnits || empties.length === 0 || !empties.every((e) => stockedUnits < e.units)) {
      skipped.push(`${r.handle}: stoklu varyant (${r.stoklu_sku}, ${r.stoklu_adet} adet) boş varyantlardan kesin küçük değil`);
      continue;
    }
    const emptySkus = new Set(empties.map((e) => e.sku));
    for (const v of variants) {
      if (v.offerId === stocked.offerId || !(emptySkus.has(v.offerId) || (v.shopifyVariantId && emptySkus.has(v.shopifyVariantId)))) continue;
      if (!v.excludedFromSubmit) toExclude.push(v.offerId);
      if (v.status !== "draft") zeroStock.push(v);
    }
  }

  console.log(`${apply ? "UYGULANIYOR" : "DRY-RUN"}: ${toExclude.length} varyant pasiflenecek, ${zeroStock.length} Ozon varyantının stoğu 0'lanacak, ${skipped.length} handle atlandı`);
  for (const s of skipped) console.log("  atlandı:", s);
  for (const v of zeroStock) console.log("  Ozon stok 0:", v.offerId);

  if (apply) {
    await prisma.product.updateMany({ where: { offerId: { in: toExclude } }, data: { excludedFromSubmit: true } });
    for (let i = 0; i < zeroStock.length; i += 100) {
      const batch = zeroStock.slice(i, i + 100);
      const { result } = await updateStocks(
        batch.map((v) => ({ offerId: v.offerId, stock: 0, warehouseId: selectWarehouseId(v.weightGrams ?? 100, v.widthCm, v.heightCm, v.depthCm) })),
      );
      for (const entry of result) {
        if (entry.updated) await prisma.product.update({ where: { offerId: entry.offer_id }, data: { stockQuantity: 0 } });
        else console.log("  HATA:", entry.offer_id, entry.errors.map((e) => e.message).join("; "));
      }
    }
    console.log("Tamam.");
  } else console.log("Yazmak için --apply ekleyin.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
