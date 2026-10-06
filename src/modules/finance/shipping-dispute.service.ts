import { prisma } from "../../db/prisma";
import { getUsdToRubRate } from "../../pricing/fx-rate";
import { sumRealShippingRub } from "./pnl-report.service";

// Finans Mütabakatı (2026-09-28, kullanıcı talebi): Çekmeköy 500g altı (extrasmall tarifesi)
// deposundan çıkan, Ozon'un GERÇEK kargo kesintisi extrasmall tarifesinin normal üst sınırını
// ($3.3) aşan siparişleri tek yerden takip eder. Kullanıcı bunları Ozon'a elle bildirir/itiraz
// eder (bkz. app/finans-mutabakat) — bu servis sadece VERİYİ toplar + itiraz durumunu
// günceller, Ozon'a otomatik hiçbir şey göndermez (ASE gönderimindeki modelin aksine, burada
// "itiraz" Ozon panelinin dışında, elle yapılan bir süreç).
export const EXTRASMALL_WAREHOUSE_LABEL = "Cekmekoy-500gr altı";
// DÜZELTME (2026-09-28, kullanıcı bulgusu: ilk sürümde yanlışlıkla $3.3 kullanılmıştı) — doğru
// eşik $3.55.
export const SHIPPING_DISPUTE_THRESHOLD_USD = 3.55;

// Bazı FinanceTransaction "RfbsGlobalDelivery" kayıtları tek bir extrasmall paketin kargosu için
// anlamsız derecede yüksek tutarlar taşıyor (2026-09-28'de tespit edildi: $1.400-1.800 arası,
// normal aralık $1-12) — bunlar muhtemelen Ozon tarafında yanlış eşleşmiş bir muhasebe kaydı,
// gerçek bir "aşırı ücretlendirme" itirazı DEĞİL. Mütabakat listesine değil, ayrı bir "veri
// hatası" grubuna düşürüyoruz ki itiraz iş akışını kirletmesin.
export const SHIPPING_DISPUTE_ANOMALY_CEILING_USD = 50;

export interface ShippingDisputeRow {
  postingNumber: string;
  status: string;
  orderDate: string | null;
  shippingRub: number;
  shippingUsd: number;
  disputeStatus: "none" | "disputed" | "resolved";
  disputedAt: string | null;
  disputedAmountUsd: number | null;
  resolvedAt: string | null;
  resolvedAmountUsd: number | null;
}

async function getExtrasmallDeliveredOrdersWithShipping(): Promise<
  Array<{
    postingNumber: string;
    status: string;
    orderDate: Date | null;
    shippingRub: number;
    shippingUsd: number;
    shippingDisputeStatus: string | null;
    shippingDisputedAt: Date | null;
    shippingDisputedAmountUsd: number | null;
    shippingDisputeResolvedAt: Date | null;
    shippingDisputeResolvedAmountUsd: number | null;
  }>
> {
  const usdToRubRate = await getUsdToRubRate();
  if (!usdToRubRate) return [];

  const orders = await prisma.order.findMany({
    where: {
      status: "delivered",
      OR: [
        { rawPayload: { path: ["analytics_data", "warehouse"], string_contains: "500gr alt" } },
        { rawPayload: { path: ["analytics_data", "tpl_provider"], string_contains: "Extra Small" } },
      ],
    },
    select: {
      postingNumber: true,
      status: true,
      orderDate: true,
      shippingDisputeStatus: true,
      shippingDisputedAt: true,
      shippingDisputedAmountUsd: true,
      shippingDisputeResolvedAt: true,
      shippingDisputeResolvedAmountUsd: true,
    },
  });
  if (orders.length === 0) return [];

  const postingNumbers = orders.map((o) => o.postingNumber);
  const transactions = await prisma.financeTransaction.findMany({
    where: { postingNumber: { in: postingNumbers } },
    select: { postingNumber: true, deliveryCharge: true },
  });
  const byPosting = new Map<string, typeof transactions>();
  for (const t of transactions) {
    const list = byPosting.get(t.postingNumber) ?? [];
    list.push(t);
    byPosting.set(t.postingNumber, list);
  }

  const result = [];
  for (const order of orders) {
    const shippingRub = sumRealShippingRub(byPosting.get(order.postingNumber) ?? []);
    if (shippingRub == null) continue;
    result.push({
      postingNumber: order.postingNumber,
      status: order.status,
      orderDate: order.orderDate,
      shippingRub,
      shippingUsd: shippingRub / usdToRubRate,
      shippingDisputeStatus: order.shippingDisputeStatus,
      shippingDisputedAt: order.shippingDisputedAt,
      shippingDisputedAmountUsd: order.shippingDisputedAmountUsd,
      shippingDisputeResolvedAt: order.shippingDisputeResolvedAt,
      shippingDisputeResolvedAmountUsd: order.shippingDisputeResolvedAmountUsd,
    });
  }
  return result;
}

function toRow(o: Awaited<ReturnType<typeof getExtrasmallDeliveredOrdersWithShipping>>[number]): ShippingDisputeRow {
  return {
    postingNumber: o.postingNumber,
    status: o.status,
    orderDate: o.orderDate ? o.orderDate.toISOString().slice(0, 10) : null,
    shippingRub: o.shippingRub,
    shippingUsd: o.shippingUsd,
    disputeStatus: o.shippingDisputeStatus === "disputed" ? "disputed" : o.shippingDisputeStatus === "resolved" ? "resolved" : "none",
    disputedAt: o.shippingDisputedAt ? o.shippingDisputedAt.toISOString() : null,
    disputedAmountUsd: o.shippingDisputedAmountUsd,
    resolvedAt: o.shippingDisputeResolvedAt ? o.shippingDisputeResolvedAt.toISOString() : null,
    resolvedAmountUsd: o.shippingDisputeResolvedAmountUsd,
  };
}

export interface ShippingDisputeGroups {
  // Eşiği aşan ama henüz kullanıcı tarafından itiraz edilmemiş — YENİ tespit edilenler.
  notDisputed: ShippingDisputeRow[];
  // Kullanıcı itiraz etti, Ozon henüz düzeltmedi (bkz. runShippingDisputeRecheck).
  disputed: ShippingDisputeRow[];
  // İtiraz sonrası Ozon'un kesintiyi değiştirdiği (düzelttiği) siparişler.
  resolved: ShippingDisputeRow[];
  // Tek paket için anlamsız derecede yüksek tutar (>$50) — muhtemelen veri hatası, itiraz
  // iş akışının dışında, sadece bilgilendirme amaçlı.
  anomalies: ShippingDisputeRow[];
}

export async function getShippingDisputeGroups(): Promise<ShippingDisputeGroups> {
  const orders = await getExtrasmallDeliveredOrdersWithShipping();
  const groups: ShippingDisputeGroups = { notDisputed: [], disputed: [], resolved: [], anomalies: [] };

  for (const o of orders) {
    const row = toRow(o);
    if (o.shippingDisputeStatus === "resolved") {
      groups.resolved.push(row);
      continue;
    }
    if (o.shippingDisputeStatus === "disputed") {
      groups.disputed.push(row);
      continue;
    }
    if (o.shippingUsd > SHIPPING_DISPUTE_ANOMALY_CEILING_USD) {
      groups.anomalies.push(row);
      continue;
    }
    if (o.shippingUsd > SHIPPING_DISPUTE_THRESHOLD_USD) {
      groups.notDisputed.push(row);
    }
  }

  const byDateDesc = (a: ShippingDisputeRow, b: ShippingDisputeRow) => (b.orderDate ?? "").localeCompare(a.orderDate ?? "");
  groups.notDisputed.sort(byDateDesc);
  groups.disputed.sort(byDateDesc);
  groups.resolved.sort(byDateDesc);
  groups.anomalies.sort(byDateDesc);
  return groups;
}

// Panelden "İtiraz Edildi İşaretle" butonu — o ANKİ gerçek kargo tutarını baseline olarak
// donduruyor (shippingDisputedAmountUsd), periyodik kontrol bunu referans alıp Ozon'un kesintiyi
// değiştirip değiştirmediğine bakıyor.
export async function markOrdersDisputed(postingNumbers: string[]): Promise<number> {
  if (postingNumbers.length === 0) return 0;
  const usdToRubRate = await getUsdToRubRate();
  if (!usdToRubRate) throw new Error("Güncel USD/RUB kuru alınamadı, tutar dondurulamadı");

  const transactions = await prisma.financeTransaction.findMany({
    where: { postingNumber: { in: postingNumbers } },
    select: { postingNumber: true, deliveryCharge: true },
  });
  const byPosting = new Map<string, typeof transactions>();
  for (const t of transactions) {
    const list = byPosting.get(t.postingNumber) ?? [];
    list.push(t);
    byPosting.set(t.postingNumber, list);
  }

  const now = new Date();
  let updated = 0;
  for (const postingNumber of postingNumbers) {
    const shippingRub = sumRealShippingRub(byPosting.get(postingNumber) ?? []);
    if (shippingRub == null) continue;
    await prisma.order.update({
      where: { postingNumber },
      data: {
        shippingDisputeStatus: "disputed",
        shippingDisputedAt: now,
        shippingDisputedAmountUsd: shippingRub / usdToRubRate,
        shippingDisputeResolvedAt: null,
        shippingDisputeResolvedAmountUsd: null,
      },
    });
    updated += 1;
  }
  return updated;
}

// sync-orders-cron.ts tarafından periyodik çağrılır — "disputed" durumundaki siparişlerin GÜNCEL
// gerçek kargo tutarını itiraz anındaki (shippingDisputedAmountUsd) baseline'la karşılaştırır.
// Ozon tutarı DÜZELTTİYSE (1 sentten fazla fark varsa) "resolved"a geçirir; düzeltme yoksa
// "disputed" olarak kalır, kullanıcı panelde "İtiraz Edildi (Bekliyor)" sekmesinde görmeye
// devam eder.
export async function recheckDisputedShipping(): Promise<{ checked: number; resolved: number }> {
  const usdToRubRate = await getUsdToRubRate();
  if (!usdToRubRate) return { checked: 0, resolved: 0 };

  const disputed = await prisma.order.findMany({
    where: { shippingDisputeStatus: "disputed" },
    select: { postingNumber: true, shippingDisputedAmountUsd: true },
  });
  if (disputed.length === 0) return { checked: 0, resolved: 0 };

  const postingNumbers = disputed.map((o) => o.postingNumber);
  const transactions = await prisma.financeTransaction.findMany({
    where: { postingNumber: { in: postingNumbers } },
    select: { postingNumber: true, deliveryCharge: true },
  });
  const byPosting = new Map<string, typeof transactions>();
  for (const t of transactions) {
    const list = byPosting.get(t.postingNumber) ?? [];
    list.push(t);
    byPosting.set(t.postingNumber, list);
  }

  const now = new Date();
  let resolved = 0;
  for (const order of disputed) {
    const shippingRub = sumRealShippingRub(byPosting.get(order.postingNumber) ?? []);
    if (shippingRub == null) continue;
    const currentUsd = shippingRub / usdToRubRate;
    const baseline = order.shippingDisputedAmountUsd ?? currentUsd;
    if (Math.abs(currentUsd - baseline) <= 0.01) continue;

    await prisma.order.update({
      where: { postingNumber: order.postingNumber },
      data: {
        shippingDisputeStatus: "resolved",
        shippingDisputeResolvedAt: now,
        shippingDisputeResolvedAmountUsd: currentUsd,
      },
    });
    resolved += 1;
  }
  return { checked: disputed.length, resolved };
}
