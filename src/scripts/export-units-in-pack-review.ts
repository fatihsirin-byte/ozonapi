// unitsInPack CSV review akışı — ADIM 1 (export). Yeni Shopify importer unitsInPack'e hiç
// dokunmuyor (bkz. handoff notu), bu yüzden bu alan çoğu üründe boş. toptantr'a giden
// Koli/Paket/Palet stok/itemPerPackage hesabı SADECE çok-varyantlı (multi-variant) handle'larda
// bu alana bağlı olduğundan (bkz. rankVariants, src/toptantr/quantity.ts), CSV'yi sadece
// birden fazla varyantı olan handle'larla sınırlıyoruz — tek varyantlı handle'larda unitsInPack
// boşsa zaten güvenli varsayılan (1) kullanılıyor.
//
// KAPSAM: Shopify kataloğunda 814 çok-varyantlı handle var ama bunların büyük kısmı
// (yüzük/havlu/çarşaf vb.) toptantr'la HİÇ ilgisi olmayan ürünler — ağırlık-bazlı tahmin
// bunlarda anlamsız gürültü üretiyor (ör. "boyut" varyantları "paket adedi" sanılıyor).
// Bu yüzden CSV, toptantr'a BUGÜN GERÇEKTEN BAĞLI olan handle'larla sınırlı — yani
// `ToptantrListing` tablosunda kaydı olanlar (2026-09-29 itibarıyla 70 handle / 191 ürün).
// Daha geniş kapsam istenirse WHERE_HANDLE_IN_TOPTANTR_LISTING=false ile çalıştırılabilir.
//
// Her satır için bir tahmin üretilir:
//   - "regex"  : extractPackQuantity(name) bir sayı buldu (ör. "6 Packs", "Pack of 12") — güvenilir.
//   - "agirlik": regex bulamadı ama aynı handle içindeki en hafif varyanta göre ağırlık oranı
//                tam sayıya yakın (ör. 400g taban, 1200g varyant → 3) — BELİRSİZ, flavor/boyut
//                farkı da aynı orana benzeyebilir, elle bakılmalı.
//   - "yok"    : ne regex ne ağırlık oranı bir tahmin üretebildi — elle bakılmalı.
//
// Kullanıcı `newUnitsInPack` kolonunu doldurup CSV'yi geri verecek, sadece o kolon (boş
// bırakılanlar hariç) src/scripts/import-units-in-pack-review.ts ile DB'ye yazılacak.
//
// Çalıştırma: npx tsx src/scripts/export-units-in-pack-review.ts [çıktı-dosyası.csv]
import { prisma } from "../db/prisma";
import { extractPackQuantity } from "../import/pack-quantity";
import { writeFileSync } from "node:fs";

const WEIGHT_RATIO_TOLERANCE = 0.15;

interface Row {
  offerId: string;
  handle: string;
  variantPosition: number;
  name: string;
  weightGrams: number | null;
  currentUnitsInPack: number | null;
  suggestedUnitsInPack: number | null;
  source: "regex" | "agirlik" | "yok";
  needsReview: boolean;
}

function csvEscape(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const scopeToToptantrListing = process.env.WHERE_HANDLE_IN_TOPTANTR_LISTING !== "false";
  const handleFilter = scopeToToptantrListing
    ? { in: (await prisma.toptantrListing.findMany({ select: { shopifyHandle: true } })).map((l) => l.shopifyHandle) }
    : { not: null };

  const products = await prisma.product.findMany({
    where: { shopifyHandle: handleFilter },
    select: { offerId: true, shopifyHandle: true, name: true, weightGrams: true, unitsInPack: true, variantPosition: true },
    orderBy: [{ shopifyHandle: "asc" }, { variantPosition: "asc" }],
  });

  const byHandle = new Map<string, typeof products>();
  for (const p of products) {
    const handle = p.shopifyHandle!;
    const arr = byHandle.get(handle) ?? [];
    arr.push(p);
    byHandle.set(handle, arr);
  }

  const rows: Row[] = [];
  for (const [handle, variants] of byHandle) {
    if (variants.length <= 1) continue; // tek varyantlı handle — toptantr tiering'i etkilemiyor

    const weights = variants.map((v) => v.weightGrams).filter((w): w is number => Boolean(w));
    const baseWeight = weights.length ? Math.min(...weights) : null;

    for (const p of variants) {
      const regexGuess = extractPackQuantity(p.name);
      let suggested: number | null = null;
      let source: Row["source"] = "yok";

      if (regexGuess) {
        suggested = regexGuess;
        source = "regex";
      } else if (baseWeight && p.weightGrams) {
        const ratio = p.weightGrams / baseWeight;
        const rounded = Math.round(ratio);
        if (rounded >= 1 && Math.abs(ratio - rounded) < WEIGHT_RATIO_TOLERANCE) {
          suggested = rounded;
          source = "agirlik";
        }
      }

      rows.push({
        offerId: p.offerId,
        handle,
        variantPosition: p.variantPosition,
        name: p.name,
        weightGrams: p.weightGrams,
        currentUnitsInPack: p.unitsInPack,
        suggestedUnitsInPack: suggested,
        source,
        needsReview: source !== "regex",
      });
    }
  }

  const header = [
    "offerId",
    "handle",
    "variantPosition",
    "name",
    "weightGrams",
    "currentUnitsInPack",
    "suggestedUnitsInPack",
    "source",
    "needsReview",
    "newUnitsInPack",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.offerId),
        csvEscape(r.handle),
        csvEscape(r.variantPosition),
        csvEscape(r.name),
        csvEscape(r.weightGrams),
        csvEscape(r.currentUnitsInPack),
        csvEscape(r.suggestedUnitsInPack),
        csvEscape(r.source),
        csvEscape(r.needsReview),
        "", // newUnitsInPack — kullanıcı dolduracak
      ].join(","),
    );
  }

  const outPath = process.argv[2] ?? "unitsInPack-review.csv";
  writeFileSync(outPath, lines.join("\n"), "utf8");

  const bySource = { regex: 0, agirlik: 0, yok: 0 };
  for (const r of rows) bySource[r.source]++;
  console.log(`[export] ${rows.length} satır, ${byHandle.size} handle (çok-varyantlı: ${[...byHandle.values()].filter((v) => v.length > 1).length})`);
  console.log(`[export] Kaynak dağılımı: regex=${bySource.regex}, agirlik=${bySource.agirlik}, yok=${bySource.yok}`);
  console.log(`[export] Yazıldı: ${outPath}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
