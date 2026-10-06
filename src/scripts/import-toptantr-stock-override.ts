// toptantr elle kademe stoğunu (Product.toptantrStockOverride) CSV'den toplu yükler.
// (2026-10-06, kullanıcı talebi)
//
//   npx tsx src/scripts/import-toptantr-stock-override.ts dosya.csv           # dry-run
//   npx tsx src/scripts/import-toptantr-stock-override.ts dosya.csv --apply   # yazar
//
// CSV: başlık satırı + iki kolon `sku,stok` (ayraç , veya ;). sku = Product.offerId. stok boşsa
// override temizlenir (null = otomatik türetme). Bilinmeyen SKU'lar atlanıp raporlanır.
import fs from "node:fs";
import { prisma } from "../db/prisma";

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if ((ch === "," || ch === ";") && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!file || file.startsWith("--")) throw new Error("Kullanım: import-toptantr-stock-override.ts dosya.csv [--apply]");

  const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const rows = lines.slice(1).map(parseLine);

  const skus = rows.map((r) => r[0]);
  const existing = await prisma.product.findMany({
    where: { offerId: { in: skus } },
    select: { offerId: true, toptantrStockOverride: true },
  });
  const current = new Map(existing.map((p) => [p.offerId, p.toptantrStockOverride]));

  let changed = 0;
  let same = 0;
  const unknown: string[] = [];
  const invalid: string[] = [];
  for (const [sku, raw] of rows) {
    if (!current.has(sku)) {
      unknown.push(sku);
      continue;
    }
    const value = raw === undefined || raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      invalid.push(`${sku}=${raw}`);
      continue;
    }
    if (current.get(sku) === value) {
      same++;
      continue;
    }
    changed++;
    if (apply) await prisma.product.update({ where: { offerId: sku }, data: { toptantrStockOverride: value } });
  }

  console.log(`${apply ? "UYGULANDI" : "DRY-RUN"}: ${changed} değişecek, ${same} aynı, ${unknown.length} bilinmeyen SKU, ${invalid.length} geçersiz değer`);
  if (unknown.length) console.log("Bilinmeyen:", unknown.join(", "));
  if (invalid.length) console.log("Geçersiz:", invalid.join(", "));
  if (!apply) console.log("Yazmak için --apply ekleyin.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
