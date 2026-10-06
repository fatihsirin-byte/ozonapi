// Shopify'da İstanbul lokasyonundan (env.shopifyStockLocationId) yapılan fulfillment'ların aylık
// özeti — paketleme maliyeti hesabı için (2026-10-06, kullanıcı talebi). Hiçbir yere yazmaz.
//
//   npx tsx src/scripts/istanbul-fulfillment-stats.ts [başlangıç-ayı] [bitiş-ayı] [çıktı.csv]
//   npx tsx src/scripts/istanbul-fulfillment-stats.ts 2026-07 2026-09 ~/Desktop/istanbul.csv
//
// Tanımlar:
//  - Paket   = bir fulfillment (iptal edilenler hariç). Ay, fulfillment tarihine göre (TSİ).
//  - Sipariş = o ay İstanbul'dan en az bir paketi çıkan farklı sipariş.
//  - Ürün (unit) = paketteki varyant adetlerinin toplamı (Fulfillment.totalQuantity) — kutu içi
//    adet DEĞİL: 2 adet "1 Box" = 2 unit.
import fs from "node:fs";
import { env } from "../config/env";
import { startBulkQuery, waitForBulkOperation, downloadJsonl } from "../shopify/inventory";

interface FulfillmentRaw {
  createdAt: string;
  status: string;
  totalQuantity: number;
  location: { id: string; name: string } | null;
}
interface OrderRaw {
  id: string;
  name: string;
  sourceName: string | null;
  app: { name: string } | null;
  fulfillments: FulfillmentRaw[];
}

const SIZE_BUCKETS: [string, (n: number) => boolean][] = [
  ["1 ürün", (n) => n === 1],
  ["2 ürün", (n) => n === 2],
  ["3-5 ürün", (n) => n >= 3 && n <= 5],
  ["6-10 ürün", (n) => n >= 6 && n <= 10],
  ["11+ ürün", (n) => n >= 11],
];

function monthTsi(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000); // TSİ = UTC+3, yaz saati yok
  return d.toISOString().slice(0, 7);
}

function channelLabel(sourceName: string | null, appName?: string): string {
  if (!sourceName) return appName ?? "bilinmiyor";
  if (sourceName === "web") return "Online mağaza";
  if (sourceName === "shopify_draft_order") return "Taslak sipariş";
  if (sourceName === "pos") return "POS";
  // Sayısal sourceName = satış kanalı uygulamasının id'si — okunur ad için uygulama adını kullan.
  return appName ?? sourceName;
}

async function main() {
  const [fromMonth = "2026-07", toMonth = "2026-09", outFile] = process.argv.slice(2);
  const location = env.shopifyStockLocationId;
  if (!location) throw new Error("SHOPIFY_STOCK_LOCATION_ID tanımlı değil");

  // Fulfillment, siparişten haftalar sonra olabilir — sipariş tarihini 2 ay geriden başlatıyoruz,
  // asıl filtre aşağıda fulfillment tarihine göre.
  const [y, m] = fromMonth.split("-").map(Number);
  const orderSince = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);

  console.log(`Shopify siparişleri çekiliyor (created_at >= ${orderSince}, bulk operation)...`);
  await startBulkQuery(`{
    orders(query: "created_at:>=${orderSince}") {
      edges { node {
        id name sourceName app { name }
        fulfillments { createdAt status totalQuantity location { id name } }
      } }
    }
  }`);
  const op = await waitForBulkOperation();
  const orders = (op.url ? await downloadJsonl(op.url) : []) as OrderRaw[];
  console.log(`${orders.length} sipariş çekildi.`);

  type Agg = { orders: Set<string>; packages: number; units: number; sizes: number[] };
  const newAgg = (): Agg => ({ orders: new Set(), packages: 0, units: 0, sizes: SIZE_BUCKETS.map(() => 0) });
  const byMonth = new Map<string, Agg>();
  const byMonthChannel = new Map<string, Agg>();
  const otherLocations = new Map<string, number>();

  for (const order of orders) {
    for (const f of order.fulfillments ?? []) {
      if (f.status === "CANCELLED" || f.status === "ERROR" || f.status === "FAILURE") continue;
      const month = monthTsi(f.createdAt);
      if (month < fromMonth || month > toMonth) continue;
      if (f.location?.id !== location) {
        const key = f.location?.name ?? "lokasyonsuz";
        otherLocations.set(key, (otherLocations.get(key) ?? 0) + 1);
        continue;
      }
      const qty = f.totalQuantity ?? 0;
      const bucket = SIZE_BUCKETS.findIndex(([, test]) => test(qty));
      for (const [map, key] of [
        [byMonth, month],
        [byMonthChannel, `${month}|${channelLabel(order.sourceName, order.app?.name)}`],
      ] as const) {
        const agg = map.get(key) ?? newAgg();
        agg.orders.add(order.id);
        agg.packages += 1;
        agg.units += qty;
        if (bucket >= 0) agg.sizes[bucket] += 1;
        map.set(key, agg);
      }
    }
  }

  const months = [...byMonth.keys()].sort();
  const total = newAgg();
  for (const a of byMonth.values()) {
    a.orders.forEach((o) => total.orders.add(o));
    total.packages += a.packages;
    total.units += a.units;
    a.sizes.forEach((s, i) => (total.sizes[i] += s));
  }
  const avg = (a: Agg) => (a.packages ? (a.units / a.packages).toFixed(2).replace(".", ",") : "0");

  // CSV: Excel (TR) için ; ayraçlı, BOM'lu, üç bölüm.
  const lines: string[] = [];
  const row = (...cells: (string | number)[]) => lines.push(cells.map((c) => String(c)).join(";"));
  row(`İstanbul fulfillment özeti (${fromMonth} – ${toMonth}), ay = fulfillment tarihi (TSİ)`);
  row("Ürün = paketteki varyant adetleri toplamı (kutu içi adet değil). Paket = bir fulfillment.");
  row("");
  row("1) AYLIK ÖZET");
  row("Ay", "Sipariş", "Paket", "Ürün (unit)", "Paket başı ürün", "Sipariş başı paket");
  for (const mo of months) {
    const a = byMonth.get(mo)!;
    row(mo, a.orders.size, a.packages, a.units, avg(a), (a.packages / a.orders.size).toFixed(2).replace(".", ","));
  }
  row("TOPLAM", total.orders.size, total.packages, total.units, avg(total), (total.packages / (total.orders.size || 1)).toFixed(2).replace(".", ","));
  row("");
  row("2) PAKET BÜYÜKLÜĞÜ DAĞILIMI (paket sayısı)");
  row("Ay", ...SIZE_BUCKETS.map(([label]) => label));
  for (const mo of months) row(mo, ...byMonth.get(mo)!.sizes);
  row("TOPLAM", ...total.sizes);
  row("");
  row("3) KANAL BAZINDA");
  row("Ay", "Kanal", "Sipariş", "Paket", "Ürün (unit)", "Paket başı ürün");
  for (const key of [...byMonthChannel.keys()].sort()) {
    const [mo, ch] = key.split("|");
    const a = byMonthChannel.get(key)!;
    row(mo, ch, a.orders.size, a.packages, a.units, avg(a));
  }

  console.log("\n" + lines.join("\n"));
  if (otherLocations.size > 0) {
    console.log("\n(Diğer lokasyonlardan çıkan, dahil edilmeyen paketler:)");
    for (const [name, n] of otherLocations) console.log(`  ${name}: ${n}`);
  }
  if (outFile) {
    fs.writeFileSync(outFile, "﻿" + lines.join("\n"), "utf8");
    console.log(`\nCSV: ${outFile}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
