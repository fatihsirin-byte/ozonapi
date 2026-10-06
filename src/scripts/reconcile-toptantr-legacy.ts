// TEK SEFERLİK script — VPS'teki eski (13 Temmuz'a kadar çalışmış, o tarihten beri durmuş)
// toptantr-shopify-sync projesinin `data/processed.json` state dosyasını okuyup, o projenin
// GERÇEKTEN toptantr'a bağladığı ürünleri (status: 'success') bu projenin ToptantrListing
// tablosuna aktarır.
//
// NEDEN GEREKLİ: yeni ToptantrPanel.tsx/toptantr.service.ts bu geçmişten HABERSİZ — bir handle
// için ToptantrListing kaydı yoksa "Bağla" butonu görünür ve tıklanırsa createProduct çağrılır.
// Product.barcode alanı yeni eklendiği için (henüz Shopify'dan geri doldurulmadı) çoğu üründe
// NULL — barcodeOf() bu durumda SKU'ya düşüyor, ki bu toptantr'ın o ürün için GERÇEKTEN kayıtlı
// barkoduyla (Shopify barkod alanı, SKU'dan farklı) EŞLEŞMEZ. Yani "zaten bağlı" bir ürün için
// "Bağla"ya basılırsa self-heal (duplicate-barcode yakalama) devreye GİRMEZ — toptantr'da GERÇEK
// bir mükerrer ürün oluşur. Bu script bunu, ToptantrListing'i baştan doğru durumla doldurarak
// önlüyor (bu 72 üründe "Bağla" hiç görünmeyecek, sadece "Yenile").
//
// Kullanım: npx tsx src/scripts/reconcile-toptantr-legacy.ts           (varsayılan: dry-run, yazmaz)
//           npx tsx src/scripts/reconcile-toptantr-legacy.ts --apply   (gerçekten ToptantrListing'e yazar)
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "../db/prisma";
import { shopifyGraphQl } from "../shopify/client";

// DB'de hiç Product satırı olmayan (henüz import edilmemiş) eski ürünlerin handle'ı, legacy
// shopifyId'sinden Shopify'dan çözülür — ToptantrListing yine de açılır ki ürün sonradan import
// edilince "Bağla" görünüp mükerrer ürün oluşturmasın (2026-10-06).
async function fetchHandleFromShopify(shopifyId: string): Promise<string | null> {
  try {
    const data = await shopifyGraphQl<{ product: { handle: string } | null }>(
      `query($id: ID!) { product(id: $id) { handle } }`,
      { id: `gid://shopify/Product/${shopifyId}` },
    );
    return data.product?.handle ?? null;
  } catch {
    return null;
  }
}

// ESM'de __dirname yok — bu script her zaman proje kökünden (`npx tsx src/scripts/...`)
// çalıştırıldığı için process.cwd() güvenli.
const LEGACY_FILE = path.join(process.cwd(), "private-uploads", "toptantr-legacy", "processed.json");

interface LegacyVariant {
  sku: string;
  approved?: boolean;
}

interface LegacyEntry {
  shopifyId: string;
  title: string;
  translatedTitle?: string;
  shortDescription?: string;
  fullDescription?: string;
  variants: LegacyVariant[];
  categoryGuid?: string;
  brandGuid?: string | null;
  status: string;
  barcode?: string;
  toptantrId?: string | number;
  timestamp?: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const legacy = JSON.parse(readFileSync(LEGACY_FILE, "utf8")) as Record<string, LegacyEntry>;
  const successEntries = Object.entries(legacy).filter(([, v]) => v.status === "success");

  console.log(`${successEntries.length} eski (VPS'te başarıyla toptantr'a gönderilmiş) ürün bulundu.`);
  console.log(apply ? "APPLY modu — ToptantrListing'e gerçekten yazılacak." : "DRY-RUN modu — hiçbir şey yazılmayacak (--apply ile çalıştırın).");

  let created = 0;
  let skippedNoMatch = 0;
  let skippedInconsistentHandle = 0;
  const inconsistentSamples: { shopifyId: string; title: string; handles: string[] }[] = [];

  for (const [shopifyId, entry] of successEntries) {
    const skus = entry.variants.map((v) => v.sku).filter(Boolean);
    const products = await prisma.product.findMany({
      where: { offerId: { in: skus } },
      select: { offerId: true, shopifyHandle: true },
    });

    const handles = new Set(products.map((p) => p.shopifyHandle).filter(Boolean));
    if (products.length === 0) {
      const fromShopify = entry.shopifyId ? await fetchHandleFromShopify(entry.shopifyId) : null;
      if (!fromShopify) {
        skippedNoMatch += 1;
        console.log(`  ATLANDI (SKU DB'de yok, Shopify'dan handle da çözülemedi): ${shopifyId} — ${entry.title}`);
        continue;
      }
      handles.add(fromShopify);
    }
    if (handles.size !== 1) {
      skippedInconsistentHandle += 1;
      inconsistentSamples.push({ shopifyId, title: entry.title, handles: [...handles] as string[] });
      console.log(
        `  ATLANDI (varyantlar ŞİMDİ birden fazla handle'a bölünmüş — Shopify'da ürün değişmiş, ELLE kontrol gerekiyor): ${shopifyId} — ${entry.title} — handle'lar: ${[...handles].join(", ")}`,
      );
      continue;
    }

    const handle = [...handles][0] as string;

    if (apply) {
      await prisma.toptantrListing.upsert({
        where: { shopifyHandle: handle },
        create: {
          shopifyHandle: handle,
          toptantrProductId: entry.toptantrId != null ? String(entry.toptantrId) : null,
          toptantrBarcode: entry.barcode ?? null,
          categoryGuid: entry.categoryGuid ?? null,
          brandGuid: entry.brandGuid ?? null,
          translatedTitle: entry.translatedTitle ?? null,
          shortDescription: entry.shortDescription ?? null,
          fullDescription: entry.fullDescription ?? null,
          status: "success",
          lastSyncedAt: entry.timestamp ? new Date(entry.timestamp) : new Date(),
        },
        // Zaten bir kayıt varsa (ör. script iki kere çalıştırıldıysa) ÜZERİNE YAZMIYORUZ — bu
        // script sadece "hiç kaydı olmayan" handle'ları doldurmak için, sonradan panelden elle
        // yapılmış bir bağlantıyı asla ezmemeli.
        update: {},
      });
      // Zaten kayıtlı listing'lerde de toptantr barkodu BOŞSA doldur (dolu olanı ezmez).
      if (entry.barcode) {
        await prisma.toptantrListing.updateMany({
          where: { shopifyHandle: handle, toptantrBarcode: null },
          data: { toptantrBarcode: entry.barcode },
        });
      }
      // Bu üründe daha önce onaylanmış (approved: true) kademeleri, yeni toptantrApproved alanına
      // da işaretle — aksi halde panel açıldığında hiçbir kademe onaylı görünmez.
      const approvedSkus = entry.variants.filter((v) => v.approved).map((v) => v.sku);
      if (approvedSkus.length > 0) {
        await prisma.product.updateMany({ where: { offerId: { in: approvedSkus } }, data: { toptantrApproved: true } });
      }
    }
    created += 1;
  }

  console.log("\n=== ÖZET ===");
  console.log(`Aktarılan (ya da apply olmadan aktarılacak): ${created}`);
  console.log(`SKU/handle çözülemedi: ${skippedNoMatch}`);
  console.log(`Birden fazla handle'a bölünmüş (elle bakılmalı): ${skippedInconsistentHandle}`);
  if (inconsistentSamples.length > 0) {
    console.log(JSON.stringify(inconsistentSamples, null, 1));
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
