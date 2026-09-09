import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../db/prisma";
import { syncFbsOrders } from "../modules/orders/orders.service";
import { syncTransactionsForDateRange } from "../modules/finance/finance.service";
import { getPnlRows, buildPnlCsv } from "../modules/finance/pnl-report.service";

// Mağazanın ilk gerçek ürününün oluşturulduğu tarihten (2026-07-29) biraz önceye çekilmiş
// güvenli bir alt sınır — "bu zamana kadar gelen TÜM siparişler" isteniyor, cron'un normal
// penceresi (30 gün) yeterli olmayabilir, bu yüzden export'tan önce baştan sona tam bir
// senkronizasyon yapılıyor (upsert olduğu için tekrar çalıştırmak güvenli).
const HISTORY_START = "2026-07-01T00:00:00.000Z";

// /v3/finance/transaction/list "too long period, only one month allowed" hatası veriyor —
// posting listesi gibi geniş bir aralığı tek seferde kabul etmiyor, bu yüzden finans
// senkronizasyonunu 30 günlük parçalara bölüyoruz (posting/sipariş senkronizasyonunda bu kısıt yok).
async function syncTransactionsInChunks(startIso: string, endIso: string): Promise<number> {
  const CHUNK_MS = 29 * 24 * 60 * 60 * 1000;
  let cursor = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  let total = 0;
  while (cursor < end) {
    const chunkEnd = Math.min(cursor + CHUNK_MS, end);
    total += await syncTransactionsForDateRange(new Date(cursor).toISOString(), new Date(chunkEnd).toISOString());
    cursor = chunkEnd;
  }
  return total;
}

async function main() {
  console.log(`Tam geçmiş senkronizasyonu yapılıyor (${HISTORY_START} -> şimdi)...`);
  const now = new Date().toISOString();
  const orders = await syncFbsOrders({ since: HISTORY_START, to: now });
  const txCount = await syncTransactionsInChunks(HISTORY_START, now);
  console.log(`Senkronize edildi: ${orders.length} sipariş, ${txCount} finans işlemi.`);

  const rows = await getPnlRows();
  const csv = buildPnlCsv(rows);

  const fileName = `pnl-export-${now.slice(0, 10)}.csv`;
  const filePath = resolve(process.cwd(), fileName);
  writeFileSync(filePath, csv, "utf-8");

  console.log(`\n${rows.length} sipariş kalemi yazıldı.`);
  console.log(`Dosya: ${filePath}`);
  console.log(`(Aynı rapor artık UI'da da var: /pnl sayfası, "CSV İndir" butonu bu dosyayla birebir aynı çıktıyı üretir.)`);
}

main()
  .catch((e) => {
    console.error("ERROR", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
