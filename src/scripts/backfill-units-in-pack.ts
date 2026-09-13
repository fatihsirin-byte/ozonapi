// Tek seferlik geriye dönük düzeltme: Product.unitsInPack hiç ayarlanmamış (null) ürünleri bulup
// dolduruyor (2026-09-13, kullanıcı bulgusu: "kakao6" gibi paket ürünlerde bu alan boş kalmıştı,
// bu yüzden Analitik/Siparişler'deki adet gösterimleri yanlış çıkıyordu). Kullanıcının talimatı:
// önce Ozon'un kendi "Birimler tek bir üründe" özniteliğinden (id 8962) oku — o zaten doğru kaynak
// — bulamazsa ürün adındaki Kiril "N шт" (N adet) kalıbından çıkar.
//
// Çalıştırma: npx tsx src/scripts/backfill-units-in-pack.ts
import { prisma } from "../db/prisma";
import { getProductAttributes } from "../ozon/products";

const UNITS_IN_PACK_ATTRIBUTE_ID = 8962;
const BATCH_SIZE = 30; // Ozon hız sınırı (bkz. sync-orders-cron.ts'teki 429 geçmişi) — küçük tut.
const DELAY_MS = 500;

function extractUnitsFromName(name: string): number | null {
  // DİKKAT: JavaScript regex'inde \b (kelime sınırı) SADECE ASCII [A-Za-z0-9_] karakterlerini
  // "kelime karakteri" sayar — Kiril harfleri \W (kelime DIŞI) kabul edilir. Bu yüzden "шт\b" gibi
  // bir desen, "шт" noktalama/boşlukla bitiyorsa (ör. "3 шт., по 150 г" — nokta niet-word, "т" da
  // niet-word, aralarında sınır YOK) SESSİZCE eşleşmiyordu (2026-09-13'te canlıda tespit edildi,
  // "kakao6" düzelirken 483 üründen sadece Ozon API'den bulunanlar düzeldi, isimden hiçbiri
  // yakalanamadı). Burada \b yerine "штук" (tam kelime) ya da "шт" + noktalama/boşluk/sonlanma
  // için negatif lookahead (bir sonraki Kiril küçük harfe İZİN VERME) kullanılıyor.
  const match = name.match(/(\d+)\s*шт(?:ук)?(?![а-яё])/i);
  if (!match) return null;
  const n = Number(match[1]);
  return n > 1 ? n : null;
}

async function main() {
  const products = await prisma.product.findMany({
    where: { unitsInPack: null },
    select: { offerId: true, name: true, ozonProductId: true },
  });
  console.log(`[backfill] unitsInPack eksik ${products.length} ürün bulundu`);

  let fromOzon = 0;
  const withOzonId = products.filter((p) => p.ozonProductId);
  for (let i = 0; i < withOzonId.length; i += BATCH_SIZE) {
    const batch = withOzonId.slice(i, i + BATCH_SIZE);
    try {
      const { result } = await getProductAttributes(batch.map((p) => p.offerId));
      for (const entry of result) {
        const attr = entry.attributes.find((a) => a.id === UNITS_IN_PACK_ATTRIBUTE_ID);
        const raw = attr?.values?.[0]?.value;
        const units = raw ? Number(raw) : null;
        if (units && units > 1) {
          await prisma.product.update({ where: { offerId: entry.offer_id }, data: { unitsInPack: units } });
          fromOzon += 1;
          console.log(`[ozon] ${entry.offer_id}: ${units}`);
        }
      }
    } catch (err) {
      console.error(`[backfill] Ozon isteği başarısız (${i}-${i + BATCH_SIZE}):`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const stillNull = await prisma.product.findMany({
    where: { unitsInPack: null },
    select: { offerId: true, name: true },
  });
  let fromName = 0;
  for (const p of stillNull) {
    const units = extractUnitsFromName(p.name);
    if (units) {
      await prisma.product.update({ where: { offerId: p.offerId }, data: { unitsInPack: units } });
      fromName += 1;
      console.log(`[isim] ${p.offerId} ("${p.name}"): ${units}`);
    }
  }

  console.log(`[backfill] Bitti — Ozon'dan: ${fromOzon}, isimden: ${fromName}, hâlâ eksik: ${stillNull.length - fromName}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
