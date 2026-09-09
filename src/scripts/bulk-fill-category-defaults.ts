// Çay/kahve/helva/tesbih draft ürünlerine kategori + ortak attribute'ları toplu ön-doldurma.
// Kullanıcı talebi (2026-08): "bu kartlara girip göndermeye başlayacağımda hazır gelsin" — Ozon'a
// HENÜZ gönderilmiyor, sadece Product.descriptionCategoryId/typeId/draftAttributes dolduruluyor,
// HandleEditor (app/import/[handle]/HandleEditor.tsx) bunu açılışta forma otomatik yüklüyor.
//
// Marka kuralı (kullanıcının kelimesi kelimesine talimatı): "doldurabildiklerini doldur
// dolduramadıklarını boş bırak ozon apiden markaları sorabilirsin" — yani isimden çıkarılan
// aday marka Ozon'un GERÇEK marka sözlüğünde (attribute 85) birebir (case-insensitive) eşleşirse
// doldurulur, eşleşmezse Marka alanı tamamen BOŞ bırakılır (varsayılan "No Brand" YOK).
//
// Çalıştırma: npx tsx src/scripts/bulk-fill-category-defaults.ts --dry-run   (önce bunu çalıştır)
//             npx tsx src/scripts/bulk-fill-category-defaults.ts             (gerçek yazım)

import { prisma } from "../db/prisma";
import { searchAttributeValues } from "../ozon/categories";

const DRY_RUN = process.argv.includes("--dry-run");

type Group = "tea" | "coffee" | "halva" | "beads";

const CATEGORY: Record<Group, { descriptionCategoryId: number; typeId: number; typeName: string; path: string }> = {
  tea: { descriptionCategoryId: 17028764, typeId: 97043, typeName: "Hazır çay", path: "Продукты питания / Чай, кофе / Чай / Hazır çay" },
  coffee: { descriptionCategoryId: 17028764, typeId: 94690, typeName: "Öğütülmüş kahve", path: "Продукты питания / Чай, кофе / Кофе / Öğütülmüş kahve" },
  halva: { descriptionCategoryId: 17028773, typeId: 97036, typeName: "Helva", path: "Продукты питания / Кондитерские изделия / Восточные сладости / Helva" },
  beads: { descriptionCategoryId: 77011122, typeId: 261138229, typeName: "Tesbih", path: "Дом и сад / Религиозные принадлежности / Tesbih" },
};

// Attribute id'leri — bkz. getCategoryAttributes dökümü (2026-08-14, TR dilinde çekildi).
const ATTR = {
  MODEL_NAME: 9048, // HandleEditor tarafında zaten otomatik yönetiliyor, buraya yazılmıyor.
  BRAND: 85,
  TYPE: 8229,
  UNITS_IN_PACK: 8962,
  WEIGHT_G: 4383,
  MAX_TEMP: 10350,
  MIN_TEMP: 10351,
  STORAGE_CONDITIONS: 8787,
  CONTENT: 8050, // İçerik — ürüne özel, kasıtlı olarak boş bırakılıyor.
  SHELF_LIFE_DAYS: 7578, // Raf ömrü — ürüne özel, kasıtlı olarak boş bırakılıyor.
} as const;

// Çay/kahve/helva için jenerik (kategori genelinde geçerli, ürüne özel olmayan) depolama varsayımları.
const GENERIC_STORAGE = {
  minTempC: 0,
  maxTempC: 25,
  conditionsText: "Kuru, serin ve doğrudan güneş ışığı almayan bir yerde saklayınız.",
};

const INCLUDE: Record<Group, RegExp[]> = {
  tea: [/\btea\b/i, /çay/i],
  coffee: [/\bcoffee\b/i, /kahve/i],
  halva: [/\bhalva\b/i, /helva/i],
  beads: [/tesbih/i, /tespih/i, /tasbih/i, /prayer\s*bead/i],
};

const EXCLUDE: Record<Group, RegExp[]> = {
  tea: [
    /\bcup\b/i, /\bcups\b/i, /\bmug\b/i, /\bglass\b/i, /\bglasses\b/i, /\bplate\b/i, /\bplates\b/i,
    /\bsaucer\b/i, /\bsaucers\b/i, /\bpot\b(?!\s*bags?)/i, /\bpots\b(?!\s*bags?)/i, /\bset\b/i, /\bsets\b/i,
    /\bmugs\b/i, /\bkettle\b/i, /\bservice\b/i, /\btray\b/i, /\bspoon\b/i, /\bspoons\b/i, /\bstrainer\b/i, /\binfuser\b/i,
    /\bfilter\b/i, /\bdispenser\b/i, /essential\s*oil/i, /\bshampoo\b/i, /\btree\b/i, /\btear\b/i,
    /\blight\b/i, /\bcanister\b/i, /\bjar\b/i, /\bholder\b/i, /\bwarmer\b/i, /\bcoz(y|ies)\b/i,
    /\bmaker\b/i, /\bmachine\b/i, /\bpress\b/i, /\bpercolator\b/i, /\bsamovar\b/i, /\bteapot\b/i,
    /fincan/i, /tabağ/i, /tabak/i, /\bseti\b/i, /bardağ/i, /bardak/i, /sürahi/i, /süzgeç/i,
    /demlik/i, /\bnecklace\b/i, /\bextract\b/i, /\bsupplement\b/i, /\bcapsule/i,
  ],
  coffee: [
    /\bcup\b/i, /\bcups\b/i, /\bpot\b(?!\s*bags?)/i, /\bpots\b(?!\s*bags?)/i, /\bset\b/i, /\bsets\b/i,
    /\bglass\b/i, /\bmaker\b/i, /\bmachine\b/i, /\bgrinder\b/i, /değirmen/i, /makine/i, /\bfilter\b/i,
    /\bstrain/i, /\btray\b/i, /sifon/i, /\bfunnel\b/i, /huni/i, /\bspoon\b/i, /\bspoons\b/i, /\bpress\b/i,
    /\bkettle\b/i, /fincan/i, /takım/i, /takımı/i, /servis/i, /cezve/i, /ibrik/i, /\bmug\b/i, /\bmugs\b/i,
    /\bwarmer\b/i, /\btable\b/i, /\bsaucer\b/i, /\bsaucers\b/i,
  ],
  halva: [/\bcandle\b/i, /\bsoap\b/i, /\blotion\b/i, /\bcream\b/i, /\bperfume\b/i],
  beads: [/\banklet\b/i, /\bearring/i, /\bring\b/i, /keychain/i],
};

// Marka adayı çıkarırken "burada marka bitti, pazarlama/tarif kelimeleri başlıyor" sinyali veren kelimeler.
const STOPWORDS = new Set([
  "premium","professional","traditional","authentic","classic","plain","natural","naturel",
  "organic","gourmet","artisanal","fresh","diabetic","grounded","ground","roasted","instant",
  "loose","dried","aromatic","antioxidant","turkish","tea","coffee","halva","helva","herbal",
  "tahini","green","black","with","blend","mix","mixed","the","a","tin","box","pack","piece",
  "pieces","packs","bags","bag","leaf","floss","cocoa","vanilla","pistachio","rose","apple",
  "lemon","mint","chamomile","senna","sultan","detox","love","magic","magical","mystic","fruit",
  "powder","granules","granule","drink","sencha","jasmine","eucalyptus","mulberry","pomegranate",
  "orange","winter","revitalizing","relax","relaxing","soothing","calming","exotic","ottoman",
  "masala","chai","indian","spice","spices","cinnamon","ginger","hibiscus","digestive","support",
  "count","gram","grams","cardamom","hazelnut","dibek","menengic","mastic","decaf","cardomon",
  "chocolate","sachets","serve","cylinder","medium","single","x","of","for","and","no","sugar",
  "free","gluten","vegan","made","from","local","sesame","seeds","wood","pearl","tasbih","tasseled",
  "jade","silver","tone","prayer","beads","sterling","tassel","onyx","stone","amber","cut","kazaz",
  "fire","globe","sphere","barley","boxed","dhikrmatic","gift","set","cm","mm","gr","g","kg",
  // Jenerik pazarlama sıfatları — bunlar Ozon'un GLOBAL marka sözlüğünde (tüm kategoriler ortak,
  // kategoriye göre filtrelenmiyor) rastgele alakasız bir markayla birebir çakışabiliyor (örn.
  // "Yellow", "Luxury", "Serene", "Fragrant" — gerçekten var ama tamamen ilgisiz ürünlerin markası).
  "yellow","luxury","serene","fragrant","elegant","delicate","tranquil",
]);

function classify(group: Group, name: string): boolean {
  if (!INCLUDE[group].some((re) => re.test(name))) return false;
  if (EXCLUDE[group].some((re) => re.test(name))) return false;
  return true;
}

// İsimden aday marka çıkarır: pipe-öncesi (varsa, en güvenilir imza — satıcı bilinçli olarak
// "Marka | Ürün açıklaması" kalıbını kullanmış) VE stopword'e kadarki TAM kelime dizisi (kısaltılmış
// alt-önekler DENENMİYOR — örn. "Yellow Jade" eşleşmezse "Yellow" tek başına denenmiyor). Bunun
// nedeni: Ozon'un marka sözlüğü TÜM kategoriler için ortak/global — kısa jenerik kelimeler
// (Yellow, Luxury, Serene, Sukru, La...) sözlükte ürünle hiçbir ilgisi olmayan başka bir kayıtla
// rastgele birebir çakışabiliyor (canlıda doğrulandı, bkz. commit mesajı). Tam pipe/tam-run
// dışında kısaltma denenmediği için bu tuzağa düşme riski çok düşük.
function extractBrandCandidates(name: string): string[] {
  const candidates: string[] = [];
  const pipeIdx = name.indexOf(" | ");
  if (pipeIdx > 0) {
    candidates.push(name.slice(0, pipeIdx).trim());
  }
  const words = name.split(/\s+/);
  const run: string[] = [];
  for (const w of words) {
    const bare = w.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
    if (!bare || STOPWORDS.has(bare)) break;
    run.push(w);
    if (run.length >= 4) break;
  }
  if (run.length > 0) candidates.push(run.join(" "));
  // Tekilleştir (case-insensitive), boşları at.
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.toLowerCase();
    if (!c || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Bir grup için tüm ürünlerdeki benzersiz marka adaylarını TEK SEFER Ozon'a sorup cache'liyoruz
// (aynı aday birden çok üründe tekrar ediyor — API çağrısını gruplama başına ~1000'den ~40'a indiriyor).
async function verifyBrands(
  candidates: string[],
  descriptionCategoryId: number,
  typeId: number,
): Promise<Map<string, { dictionaryValueId: number; value: string }>> {
  const result = new Map<string, { dictionaryValueId: number; value: string }>();
  for (const candidate of candidates) {
    try {
      const res = await searchAttributeValues({
        attributeId: ATTR.BRAND,
        descriptionCategoryId,
        typeId,
        value: candidate,
        limit: 10,
      });
      const exact = res.result.find((r) => r.value.trim().toLowerCase() === candidate.trim().toLowerCase());
      if (exact) {
        result.set(candidate.toLowerCase(), { dictionaryValueId: exact.id, value: exact.value });
      }
    } catch (err) {
      console.error(`  ! marka arama hatası ("${candidate}"):`, (err as Error).message);
    }
  }
  return result;
}

async function run() {
  const allDraft = await prisma.product.findMany({
    where: { status: "draft", descriptionCategoryId: null },
    select: { id: true, offerId: true, name: true, weightGrams: true, unitsInPack: true },
  });

  const summary: Record<string, { total: number; brandFilled: number; brandBlank: number }> = {};

  for (const group of Object.keys(CATEGORY) as Group[]) {
    const cat = CATEGORY[group];
    const matches = allDraft.filter((p) => classify(group, p.name));

    // Bu gruptaki tüm ürünlerin marka adaylarını topla, benzersizleştir, tek seferde doğrula.
    const candidateSet = new Set<string>();
    const candidatesByProduct = new Map<string, string[]>();
    for (const p of matches) {
      const cands = extractBrandCandidates(p.name);
      candidatesByProduct.set(p.id, cands);
      cands.forEach((c) => candidateSet.add(c));
    }
    console.log(`\n=== ${group}: ${matches.length} ürün, ${candidateSet.size} benzersiz marka adayı doğrulanıyor... ===`);
    const verified = await verifyBrands(Array.from(candidateSet), cat.descriptionCategoryId, cat.typeId);
    console.log(`  ${verified.size} aday Ozon sözlüğünde birebir eşleşti.`);

    let brandFilled = 0;
    let brandBlank = 0;

    for (const p of matches) {
      const cands = candidatesByProduct.get(p.id) ?? [];
      let brandMatch: { dictionaryValueId: number; value: string } | undefined;
      for (const c of cands) {
        const hit = verified.get(c.toLowerCase());
        if (hit) {
          brandMatch = hit;
          break;
        }
      }

      const attributes: Array<{ id: number; value?: string; dictionaryValueId?: number; displayValue?: string }> = [];

      attributes.push({ id: ATTR.TYPE, dictionaryValueId: cat.typeId, displayValue: cat.typeName });

      if (brandMatch) {
        attributes.push({ id: ATTR.BRAND, dictionaryValueId: brandMatch.dictionaryValueId, displayValue: brandMatch.value });
        brandFilled++;
      } else {
        brandBlank++;
      }

      // Birimler tek bir üründe — isimdeki "1 Box - N Packs x ..." / "1 Piece" gibi ifadelerden
      // gerçek sayıyı çıkar, bulunamazsa (veya zaten DB'de varsa) onu kullan, yoksa 1 varsay.
      const unitsFromName = extractUnitsFromName(p.name);
      const units = p.unitsInPack ?? unitsFromName ?? 1;
      attributes.push({ id: ATTR.UNITS_IN_PACK, value: String(units) });

      // Ürün ağırlığı, g — DB'de zaten var (Shopify import'tan geldi), direkt kullan.
      if (p.weightGrams != null) {
        attributes.push({ id: ATTR.WEIGHT_G, value: String(p.weightGrams) });
      }

      if (group === "tea" || group === "coffee" || group === "halva") {
        attributes.push({ id: ATTR.MIN_TEMP, value: String(GENERIC_STORAGE.minTempC) });
        attributes.push({ id: ATTR.MAX_TEMP, value: String(GENERIC_STORAGE.maxTempC) });
        attributes.push({ id: ATTR.STORAGE_CONDITIONS, value: GENERIC_STORAGE.conditionsText });
      }
      // İçerik (8050) ve Raf ömrü (7578) kasıtlı olarak boş — ürüne özel gerçek bilgi, tahmin edilmiyor.

      const draftAttributes = {
        category: {
          descriptionCategoryId: cat.descriptionCategoryId,
          typeId: cat.typeId,
          path: cat.path,
          typeName: cat.typeName,
        },
        attributes,
      };

      if (DRY_RUN) {
        console.log(
          `  [DRY] ${p.offerId} | ${p.name.slice(0, 60)} | marka=${brandMatch ? brandMatch.value : "(boş)"} | birim=${units}`,
        );
      } else {
        await prisma.product.update({
          where: { id: p.id },
          data: {
            descriptionCategoryId: cat.descriptionCategoryId,
            typeId: cat.typeId,
            draftAttributes,
          },
        });
      }
    }

    summary[group] = { total: matches.length, brandFilled, brandBlank };
  }

  console.log("\n=== ÖZET ===");
  for (const [group, s] of Object.entries(summary)) {
    console.log(`${group}: ${s.total} ürün — marka dolduruldu: ${s.brandFilled}, marka boş bırakıldı: ${s.brandBlank}`);
  }
  if (DRY_RUN) console.log("\n(--dry-run: DB'ye hiçbir yazma yapılmadı)");

  await prisma.$disconnect();
}

function extractUnitsFromName(name: string): number | null {
  const boxMatch = name.match(/-\s*1\s*Box\s*-\s*(\d+)\s*Packs?/i);
  if (boxMatch) return Number(boxMatch[1]);
  const piecesXMatch = name.match(/(\d+)\s*Pieces?\s*x/i);
  if (piecesXMatch) return Number(piecesXMatch[1]);
  if (/-\s*1\s*(Piece|Pack)\b/i.test(name)) return 1;
  return null;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
