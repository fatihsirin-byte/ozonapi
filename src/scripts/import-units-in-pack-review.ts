// unitsInPack CSV review akışı — ADIM 2 (import). Kullanıcının export-units-in-pack-review.ts
// çıktısını `newUnitsInPack` kolonunu doldurarak geri verdiği CSV'yi okur ve SADECE
// Product.unitsInPack alanını günceller (Shopify'a hiç yazılmaz — kullanıcı kararı, bkz. handoff).
// newUnitsInPack boş bırakılan satırlar atlanır (dokunulmaz).
//
// Çalıştırma: npx tsx src/scripts/import-units-in-pack-review.ts <doldurulmuş-dosya.csv> [--apply]
// --apply verilmezse DRY RUN yapılır (hiçbir şey yazılmaz, sadece ne yazılacağı listelenir).
import { prisma } from "../db/prisma";
import { readFileSync } from "node:fs";

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Kullanım: npx tsx src/scripts/import-units-in-pack-review.ts <dosya.csv> [--apply]");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");

  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const offerIdIdx = header.indexOf("offerId");
  const newValIdx = header.indexOf("newUnitsInPack");
  const currentValIdx = header.indexOf("currentUnitsInPack");
  const nameIdx = header.indexOf("name");
  if (offerIdIdx === -1 || newValIdx === -1) {
    console.error("CSV'de offerId veya newUnitsInPack kolonu bulunamadı");
    process.exit(1);
  }

  let toUpdate = 0;
  let skippedEmpty = 0;
  let skippedInvalid = 0;
  const changes: { offerId: string; from: number | null; to: number; name: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const offerId = fields[offerIdIdx]?.trim();
    const newValRaw = fields[newValIdx]?.trim();
    if (!offerId) continue;
    if (!newValRaw) {
      skippedEmpty++;
      continue;
    }
    const newVal = Number(newValRaw);
    if (!Number.isFinite(newVal) || newVal < 1 || !Number.isInteger(newVal)) {
      console.warn(`[atla] ${offerId}: geçersiz newUnitsInPack "${newValRaw}"`);
      skippedInvalid++;
      continue;
    }
    const currentValRaw = currentValIdx !== -1 ? fields[currentValIdx]?.trim() : "";
    const currentVal = currentValRaw ? Number(currentValRaw) : null;
    changes.push({ offerId, from: currentVal, to: newVal, name: nameIdx !== -1 ? fields[nameIdx] : "" });
    toUpdate++;
  }

  console.log(`[import] ${lines.length - 1} satır okundu — güncellenecek: ${toUpdate}, boş (atlandı): ${skippedEmpty}, geçersiz (atlandı): ${skippedInvalid}`);

  if (!apply) {
    console.log("[import] DRY RUN — hiçbir şey yazılmadı. Uygulamak için --apply ekleyin.");
    for (const c of changes.slice(0, 30)) {
      console.log(`  ${c.offerId}: ${c.from ?? "null"} -> ${c.to}  (${c.name})`);
    }
    if (changes.length > 30) console.log(`  ... ve ${changes.length - 30} tane daha`);
    await prisma.$disconnect();
    return;
  }

  let applied = 0;
  let notFound = 0;
  for (const c of changes) {
    try {
      await prisma.product.update({ where: { offerId: c.offerId }, data: { unitsInPack: c.to } });
      applied++;
    } catch (err) {
      notFound++;
      console.warn(`[atla] ${c.offerId} DB'de bulunamadı veya güncellenemedi:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[import] Uygulandı: ${applied}, bulunamadı: ${notFound}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
