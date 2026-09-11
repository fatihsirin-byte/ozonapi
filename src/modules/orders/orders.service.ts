import { prisma } from "../../db/prisma";
import { listFbsPostings, getFbsPosting, shipFbsPosting, type OzonFbsPosting } from "../../ozon/orders";
import { getProductAttributes } from "../../ozon/products";
import { OzonApiError } from "../../ozon/client";
import { WAREHOUSE_UNDER_500G } from "../../ozon/warehouses";
import { importFromOzon, syncMissingProductsFromOzon } from "../products/products.service";
import { computePriceBreakdown } from "../../pricing/formula";
import { effectiveCargoWeightGrams, estimateShippingForWeight } from "../finance/pnl-report.service";
import {
  uploadInvoiceFile,
  createOrUpdateInvoice,
  getInvoice,
  deleteInvoice,
  getEtgbDeclarations,
  type OzonHsCode,
} from "../../ozon/invoices";

// Ozon'un kategori formunda GTİP için İKİ attribute var: 22992 "GTİP Kodu" serbest metin (kullanıcı
// kodu zaten biliyorsa), 22232 "AEB'nin GTİP kodları" ise GERÇEK aranabilir bir sözlük (Rusça arama
// terimleriyle, örn. "кондитерские") — kullanıcı kodu bilmiyorsa asıl kullanacağı alan bu. Sözlük
// değeri "1704901000 - Кондитерские изделия..." formatında geliyor, biz sadece baştaki kodu alıyoruz.
const GTIP_FREE_TEXT_ATTRIBUTE_ID = 22992;
const GTIP_DICTIONARY_ATTRIBUTE_ID = 22232;

function extractGtipCode(rawValue: string): string {
  const match = rawValue.match(/^\d{6,12}/);
  return match ? match[0] : rawValue.trim();
}

// Tek bir Ozon posting'ini local Order/OrderItem'a upsert eder — syncFbsOrders'ın (toplu, tarih
// aralığı bazlı) VE shipOrder'ın (paketlemeden hemen sonra, TEK posting için anında) ortak
// kullandığı çekirdek mantık (2026-09-11, kullanıcı talebi: "paket bölünce yeni siparişi hemen
// göster, 15 dakika cron'unu bekleme" — daha önce bu mantık sadece syncFbsOrders içinde vardı).
async function upsertPostingIntoDb(posting: OzonFbsPosting) {
  // Bazı posting'lerde (örn. aggregator akışı) order_date boş/geçersiz geliyor — bu durumda
  // in_process_at'e düşüyoruz, o da yoksa alanı boş bırakıyoruz (upsert'in patlamaması için).
  const rawDate = posting.order_date || posting.in_process_at;
  const parsedDate = rawDate ? new Date(rawDate) : null;
  const orderDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

  const order = await prisma.order.upsert({
    where: { postingNumber: posting.posting_number },
    create: {
      postingNumber: posting.posting_number,
      status: posting.status,
      scheme: "fbs",
      orderDate,
      rawPayload: posting as unknown as object,
    },
    update: {
      status: posting.status,
      rawPayload: posting as unknown as object,
    },
  });

  for (const item of posting.products ?? []) {
    let product = await prisma.product.findUnique({ where: { offerId: item.offer_id } });
    // Ürün panelden değil, doğrudan Ozon'un kendi arayüzünden açıldıysa bizim DB'mizde hiç
    // kaydı olmuyor — görsel/isim panelde boş kalıyordu. Bu durumda Ozon'dan aynı
    // importFromOzon() ile (bkz. products.service.ts, "Ozon'dan içe aktar" butonuyla aynı
    // mantık) canlı ürün bilgisini çekip otomatik bir Product kaydı açıyoruz (2026-08-24,
    // kullanıcı talebi). costPrice bilinmediği için boş kalır — kâr hesabı bunu bekleyene
    // kadar "bilinmiyor" döner, sipariş senkronizasyonunu engellemez.
    if (!product) {
      try {
        product = await importFromOzon(item.offer_id);
      } catch (error) {
        console.error(`[upsertPostingIntoDb] ${item.offer_id} Ozon'dan otomatik içe aktarılamadı:`, error);
      }
    }
    await prisma.orderItem.upsert({
      where: { orderId_offerId: { orderId: order.id, offerId: item.offer_id } },
      create: {
        orderId: order.id,
        productId: product?.id,
        offerId: item.offer_id,
        ozonSku: item.sku != null ? BigInt(item.sku) : null,
        quantity: item.quantity,
        price: item.price,
      },
      update: {
        productId: product?.id,
        ozonSku: item.sku != null ? BigInt(item.sku) : null,
        quantity: item.quantity,
        price: item.price,
      },
    });
  }

  return order;
}

// Ozon'daki siparişleri (ve kalemlerini) çekip local DB'ye upsert eder, durum/PNL takibi için kullanılır.
export async function syncFbsOrders(params: { since: string; to: string; status?: string }) {
  let offset = 0;
  const limit = 100;
  let hasNext = true;
  const synced: OzonFbsPosting[] = [];

  while (hasNext) {
    const { result } = await listFbsPostings({ ...params, offset, limit });

    for (const posting of result.postings) {
      await upsertPostingIntoDb(posting);
      synced.push(posting);
    }

    hasNext = result.has_next;
    offset += limit;
  }

  // Ozon panelinden doğrudan açılmış, henüz hiçbir siparişe düşmemiş ürünleri de yakalamak için —
  // bir siparişi beklemeden, her senkronizasyonda tam katalog taraması yapılır (2026-09-09,
  // kullanıcı talebi). Bu adım başarısız olursa sipariş senkronizasyonunu engellemesin diye ayrı try/catch.
  try {
    const { checked, imported } = await syncMissingProductsFromOzon();
    if (imported > 0) {
      console.log(`[syncFbsOrders] Ozon kataloğu tarandı (${checked} ürün), ${imported} yeni ürün içeri alındı`);
    }
  } catch (error) {
    console.error("[syncFbsOrders] Ozon katalog taraması başarısız:", error);
  }

  return synced;
}

// Ozon'un komisyon/kargo kesintilerini muhasebeleştirmesini beklemeye gerek yok — satış fiyatı
// zaten posting.products[].price içinde sipariş anında geliyor, bunu OrderItem'da saklıyoruz.
export function computeOrderAmount(items: Array<{ price: string; quantity: number }>): number {
  return items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
}

// Alış fiyatı (costPrice) olmadan kâr hesaplanamaz — ürün eşleşmemişse (product null) ya da
// costPrice hiç girilmemişse null döner (0 değil, "bilinmiyor" ile "kâr sıfır" karışmasın diye).
export function computeOrderCost(items: Array<{ quantity: number; product: { costPrice: string | null } | null }>): number | null {
  let total = 0;
  for (const item of items) {
    const cost = item.product?.costPrice;
    if (cost == null) return null;
    total += Number(cost) * item.quantity;
  }
  return total;
}

interface EstimatedProfitItem {
  price: string;
  quantity: number;
  product: {
    costPrice: string | null;
    weightGrams: number | null;
    cargoWeightGrams: number | null;
    widthCm: number | null;
    heightCm: number | null;
    depthCm: number | null;
    heavyPackaging: boolean;
  } | null;
}

// Siparişler listesinde "Olası Net Kâr" sütunu için (2026-09-10, kullanıcı talebi: "tahmini
// ağırlıktan tahmini kargo, komisyon vs."). "Fiyat Hesaplayıcı"nın da kullandığı
// computePriceBreakdown ile aynı formülü (ağırlık paketleme payı + kademeli kargo tarifesi + Ozon
// komisyonu + lojistik hizmet bedeli + banka işlem ücreti) satılan GERÇEK fiyat üzerinden kalem
// kalem uyguluyor. Ozon bu siparişin kargo kesintisini GERÇEKTEN işlediyse (realShippingUsd —
// bkz. pnl-report.service.ts getRealShippingAndFeesUsdByPosting), tahmini ağırlık bazlı kargo
// yerine o kullanılır (2026-09-10, kullanıcı talebi: "faturası kesildiyse ... bunlardan yararlan
// kargo fiyatında") — komisyon/lojistik/banka bedeli her zaman satış fiyatı üzerinden hesaplanmaya devam eder.
// realFeesUsd verilirse (Ozon'un GERÇEK komisyon+diğer kesintileri, bkz. pnl-report.service.ts
// getRealShippingAndFeesUsdByPosting) tahmini sabit oran (%5 komisyon + %2 lojistik + %1.9 banka)
// yerine kullanılır — realShippingUsd'nin kargoda yaptığının aynısı (2026-09-11, kullanıcı talebi:
// "komisyon banka gideri iç dağıtım vs düşmüyor" — aslında düşülüyordu ama SABİT TAHMİNİ oranla;
// Ozon'un gerçekte kestiği tutar bu hesaba hiç yansımıyordu).
export function computeOrderEstimatedProfit(
  items: EstimatedProfitItem[],
  realShippingUsd?: number | null,
  realFeesUsd?: number | null,
): number | null {
  // Kalemsiz bir sipariş için hesaplanacak bir şey yok — bu koruma olmadan aşağıdaki tarife
  // formülü 0 gram için bile sabit taban ücreti (ör. -$0.80) döndürüp "kalemsiz sipariş zararda"
  // gibi hayalet bir rakam gösterirdi (2026-09-10'da code review'da tespit edildi).
  if (items.length === 0) return null;

  let totalSaleMinusCost = 0;
  let totalEstimatedFeesUsd = 0;
  let totalBillingWeightGrams = 0;
  let anyWeightMissing = false;

  for (const item of items) {
    const product = item.product;
    if (!product?.costPrice) return null;
    const breakdown = computePriceBreakdown(
      product.costPrice,
      product.weightGrams,
      { widthCm: product.widthCm, heightCm: product.heightCm, depthCm: product.depthCm },
      Number(item.price),
      product.heavyPackaging,
      product.cargoWeightGrams,
    );
    if (!breakdown) return null;
    // Kargo hariç, satış - alış kısmı adet bazında doğrusal ölçekleniyor, bu yüzden quantity ile
    // çarpılabilir. Tahmini komisyon/lojistik/banka bedeli AYRI tutuluyor (breakdown.profitUsd
    // zaten bunları düşmüş haliyle geliyordu — actualPrice - shipping - cost - profit = tahmini
    // ücret olarak geri çıkarılıyor) ki realFeesUsd verildiğinde onun yerine konabilsin.
    totalSaleMinusCost += (breakdown.actualPriceUsd - breakdown.costUsd) * item.quantity;
    const estimatedFeeUsd = breakdown.actualPriceUsd - breakdown.shippingUsd - breakdown.costUsd - breakdown.profitUsd;
    totalEstimatedFeesUsd += estimatedFeeUsd * item.quantity;

    // ÖNEMLİ: kargo tarifesinin sabit taban ücreti (ör. $0.80) paket başına BİR KEZ uygulanır —
    // birim ağırlığı quantity ile çarpıp tarifeyi TEK SEFERDE toplam ağırlığa uyguluyoruz, aksi
    // halde (computePriceBreakdown'ın birim bazlı shippingUsd'sini quantity ile çarpmak gibi) taban
    // ücret adet sayısı kadar tekrarlanıp kargo maliyeti olduğundan yüksek çıkardı (2026-09-10'da
    // code review'da tespit edildi — pnl-report.service.ts'teki 2026-08-24 tarihli aynı düzeltmeyle
    // tutarlı: "kalemlerin toplam ağırlığı TEK SEFERDE formüle uygulanıyor"). Ağırlık "var mı" kararı
    // için effectiveCargoWeightGrams KULLANILIYOR — sipariş detay sayfasındaki bitişik "Tahmini
    // Kargo" kartı da AYNI fonksiyonu kullanıyor; farklı bir kontrol (ör. computePriceBreakdown'ın
    // kendi içindeki falsy kontrolü) kullanmak weightGrams=0 olan nadir bir üründe aynı sayfadaki
    // iki kartın birbiriyle ÇELİŞMESİNE yol açıyordu (2026-09-10'da code review'da tespit edildi).
    const unitBillingWeight = effectiveCargoWeightGrams(product);
    if (unitBillingWeight == null) {
      anyWeightMissing = true;
    } else {
      totalBillingWeightGrams += unitBillingWeight * item.quantity;
    }
  }

  const feesUsd = realFeesUsd ?? totalEstimatedFeesUsd;

  if (realShippingUsd != null) return totalSaleMinusCost - feesUsd - realShippingUsd;
  // totalBillingWeightGrams <= 0 burada ARTIK engel değil — tüm kalemlerin ağırlığı gerçekten
  // (cargoWeightGrams olarak) 0 girilmişse bu geçerli bir veridir, "bilinmiyor" değil; sadece
  // anyWeightMissing (gerçekten hiç veri yoksa) null döndürülmeli (2026-09-10'da code review'da
  // tespit edildi — önceki davranış bu durumda geçerli bir kâr rakamı dönerken bu engel "-" gösterip gerileme yaratıyordu).
  if (anyWeightMissing) return null;
  // pnl-report.service.ts'teki estimateShippingForWeight KULLANILIYOR (formula.ts'teki
  // estimateShippingCostUsd DEĞİL) — sipariş detay sayfasındaki bitişik "Tahmini Kargo" kartı da
  // bu fonksiyonu kullanıyor; aynı formül iki ayrı dosyada tekrar bakımlı kalırsa biri değişip
  // diğeri değişmeyince aynı sayfada iki kart çelişebilirdi (2026-09-10'da code review'da tespit
  // edildi). İkisi şu an birebir aynı formül, sadece TEK yerden geliyor olması garanti ediliyor.
  return totalSaleMinusCost - feesUsd - estimateShippingForWeight(totalBillingWeightGrams);
}

// Sipariş arama kutusu (2026-09-09, kullanıcı talebi): müşteri adı, Ozon sipariş no, ürün SKU'su
// (Ozon'un numerik ürün kimliği), ürün adı ve offerId'nin hepsinde birden arar. NOT: sistemde
// hiçbir yerde gerçek "barkod" (EAN/UPC) verisi saklanmıyor — Ozon'un posting API'sinde de böyle
// bir alan gelmiyor (yalnızca kargo paketi için ayrı bir "barcodes" alanı var, ürünle ilgisiz) —
// bu yüzden barkod araması kapsam dışı, kullanıcıya ayrıca belirtildi.
//
// ham SQL kullanılıyor çünkü Prisma'nın JSON path filtreleri (müşteri adı rawPayload içinde
// gömülü) "mode: insensitive" desteklemiyor (2026-09-09'da code review'da tespit edildi) — ILIKE
// tüm alanlarda tutarlı büyük/küçük harf duyarsız arama sağlıyor. asSku'yu 18 haneyle sınırlamak
// da Postgres bigint taşmasını (ve sayfanın çökmesini) önlüyor (aynı incelemede tespit edildi).
export async function findSearchMatchingOrderIds(search: string): Promise<string[]> {
  const trimmed = search.trim();
  // ILIKE'ın kendi joker karakterlerini (%, _) ve kaçış karakterini (\) literal arıyormuş gibi
  // kaçırıyoruz — aksi halde offerId/SKU'larda yaygın olan "_" tek karakterlik joker gibi
  // davranıp alakasız sonuçlar da eşleşiyordu (2026-09-10'da code review'da tespit edildi).
  const escaped = trimmed.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  // asSku metin dışı bir arama için null olabiliyor — Postgres, parametre NULL geldiğinde
  // "ozonSku" sütununun tipini (bigint) çıkaramıyor ve "could not determine data type of
  // parameter" hatasıyla çöküyordu (2026-09-10'da canlıda arama yapılınca tespit edildi) —
  // bu yüzden aşağıda her iki kullanımda da ::bigint ile açıkça belirtiliyor.
  const asSku = /^\d{1,18}$/.test(trimmed) ? BigInt(trimmed) : null;

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT o.id
    FROM "Order" o
    LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
    LEFT JOIN "Product" p ON p.id = oi."productId"
    WHERE o."postingNumber" ILIKE ${pattern}
       OR (o."rawPayload" -> 'customer' ->> 'name') ILIKE ${pattern}
       OR (o."rawPayload" -> 'addressee' ->> 'name') ILIKE ${pattern}
       OR oi."offerId" ILIKE ${pattern}
       OR p."name" ILIKE ${pattern}
       OR p."nameRu" ILIKE ${pattern}
       OR (${asSku}::bigint IS NOT NULL AND oi."ozonSku" = ${asSku}::bigint)
  `;
  return rows.map((r) => r.id);
}

function matchingIdsWhere(matchingIds: string[] | null) {
  return matchingIds !== null ? { id: { in: matchingIds } } : {};
}

// Ozon'un satıcıya kargoya verme SÜRESİ olarak verdiği kesin tarih — bu tarih geçtiği hâlde sipariş
// hâlâ kargoya teslim edilmemişse (yani hâlâ bu kümenin DIŞINDaki bir durumdaysa) gecikmiş sayılır
// (2026-09-11, kullanıcı talebi: "kargoya verme süresi gecikme vs detayları gösterip gecikenler
// her statüde siparişlerde filtreleyecek"). `sent_by_seller` ("Satıcı Tarafından Gönderildi") kümeye
// BİLEREK eklendi — satıcının kargoya verme işini zaten TAMAMLADIĞI anlamına geliyor, deadline
// geçmiş olsa bile "gecikti" göstermek yanıltıcı olurdu (2026-09-11'de code review'da tespit
// edildi — ilk yazımda sadece delivering/delivered/cancelled vardı). Aynı gerekçeyle `arbitration`
// ve `client_arbitration` ("İhtilaf"/"Müşteri İhtilafı") da eklendi — bunlar normalde sipariş
// TESLİM EDİLDİKTEN SONRA açılan anlaşmazlık durumları, kargoya verme süresiyle artık alakasız
// (2026-09-11'de code review'da tespit edildi). `not_accepted` ("Kabul Edilmedi") BİLİNÇLİ olarak
// kümeye eklenMEDİ — bu durum genelde satıcının hâlâ aktif müdahale etmesi gereken bir durum,
// "iş bitti" anlamına gelmiyor.
// export ediliyor — Siparişler sayfasındaki "Kalan Süre" sütunu, bir siparişin kargoya verme
// süresinin hâlâ ANLAMLI olup olmadığını (yani zaten sevk edilmiş/tamamlanmış olmadığını) buradan
// öğreniyor (2026-09-11, kullanıcı talebi: "sevkiyata kalan süreyi... countdown gibi gösterelim").
export const SHIPPED_OR_DONE_STATUSES = new Set([
  "delivering",
  "delivered",
  "cancelled",
  "sent_by_seller",
  "arbitration",
  "client_arbitration",
]);

export interface ShipmentDelayInfo {
  isDelayed: boolean;
  daysLate: number;
  shipmentDeadline: Date | null;
}

export function getShipmentDelayInfo(order: { status: string; rawPayload: unknown }): ShipmentDelayInfo {
  const shipmentDateRaw = (order.rawPayload as { shipment_date?: string } | null)?.shipment_date;
  const shipmentDeadline = shipmentDateRaw ? new Date(shipmentDateRaw) : null;
  if (!shipmentDeadline || Number.isNaN(shipmentDeadline.getTime()) || SHIPPED_OR_DONE_STATUSES.has(order.status)) {
    return { isDelayed: false, daysLate: 0, shipmentDeadline };
  }
  const diffMs = Date.now() - shipmentDeadline.getTime();
  if (diffMs <= 0) return { isDelayed: false, daysLate: 0, shipmentDeadline };
  return { isDelayed: true, daysLate: Math.floor(diffMs / (24 * 60 * 60 * 1000)), shipmentDeadline };
}

// Ozon, stok bildirirken ağırlığa göre İKİ ayrı depoya yönlendiriyor (bkz. src/ozon/warehouses.ts,
// "Cekmekoy-500gr altı" / "cekmeköy 501g üstü") — bir sipariş "500g altı" deposundan geldiyse, o
// üründeki ağırlık TEK BAŞINA 500g altı kabul edilerek o rotaya girmiş demektir. Ama siparişte
// TOPLAM ÜRÜN ADEDİ 1'den fazlaysa (aynı ürünün 2+ adedi de, farklı ürünlerin toplamı da dahil —
// 2026-09-11'de kullanıcı netleştirdi: "onda da uyarı çıkabilir siparişteki toplam ürün adedi
// gibi", ilk yazımda sadece FARKLI ürün sayısı bakılıyordu), hepsi TEK kutuda paketlenirse toplam
// ağırlık 500g'ı geçip bu rotanın kaldıramayacağı bir pakete dönüşebilir — bu da gerçek bir
// teslimat sorununa yol açabiliyor (bkz. warehouses.ts'teki "bölgenize teslim edilmiyor" notu,
// aynı kök sorun). "501g üstü" deposundan gelen siparişlerde bu risk zaten yok, o rota daha ağır
// paketler için tasarlanmış.
// Sipariş sayfalarında (liste + detay) hem "toplam adet" gösterimi hem bu uyarı AYNI toplamı
// kullanıyor — üç ayrı yerde aynı reduce'u tekrar yazmak yerine tek bir yerden paylaşılıyor
// (2026-09-11'de code review'da tespit edildi: gelecekte "toplam adet" tanımı değişirse — ör.
// iptal edilen kalemler hariç tutulursa — üç kopyadan biri unutulup uyarı ile gösterilen adet
// birbirinden sapabilirdi).
export function orderTotalQuantity(items: Array<{ quantity: number }>): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export function getWeightSplitWarning(order: { rawPayload: unknown; items: Array<{ quantity: number }> }): boolean {
  const totalQuantity = orderTotalQuantity(order.items);
  if (totalQuantity <= 1) return false;
  const warehouseId = (order.rawPayload as { analytics_data?: { warehouse_id?: number } } | null)?.analytics_data
    ?.warehouse_id;
  return warehouseId === WAREHOUSE_UNDER_500G;
}

export async function listOrders(params: {
  status?: string;
  scheme?: string;
  since?: Date;
  to?: Date;
  invoicedSince?: Date;
  invoicedTo?: Date;
  // Arama sonucu eşleşen sipariş id'leri — çağıran taraf (app/orders/page.tsx) bunu tek seferde
  // hesaplayıp hem burada hem getOrderFilterCounts'ta kullanıyor; aksi halde aynı pahalı ILIKE
  // sorgusu (findSearchMatchingOrderIds) sayfa başına iki kez çalışırdı (2026-09-10'da code
  // review'da tespit edildi).
  matchingIds?: string[] | null;
  // Ozon'un kargoya verme süresi (shipment_date) geçmiş ama sipariş hâlâ kargoya teslim edilmemiş
  // (durumu delivering/delivered/cancelled DIŞINDA) siparişler — status filtresiyle BİRLİKTE değil,
  // ONUN YERİNE kullanılır (2026-09-11, kullanıcı talebi).
  delayedOnly?: boolean;
  skip?: number;
  take?: number;
}) {
  const matchingIds = params.matchingIds ?? null;

  if (params.delayedOnly) {
    // shipment_date rawPayload JSON'u içinde olduğu için DB seviyesinde filtrelenemiyor — önce
    // durum bazında (indexed, ucuz) adayları DAR bir select (items/product OLMADAN) ile çekip
    // gecikmeyi JS'te hesaplıyoruz ve sayfalamayı id bazında yapıyoruz; items+product join'i
    // SADECE o sayfada gösterilecek siparişler için ayrı bir sorguyla çekiyoruz — aksi halde
    // (ilk yazımda olduğu gibi) tüm adaylar için ağır join yapılıp büyük çoğunluğu JS'teki
    // slice ile atılıyordu (2026-09-11'de code review'da tespit edildi).
    const candidates = await prisma.order.findMany({
      where: { status: { notIn: [...SHIPPED_OR_DONE_STATUSES] }, ...matchingIdsWhere(matchingIds) },
      select: { id: true, status: true, rawPayload: true },
      orderBy: { orderDate: "desc" },
    });
    const delayedIds = candidates.filter((o) => getShipmentDelayInfo(o).isDelayed).map((o) => o.id);
    const skip = params.skip ?? 0;
    const take = params.take ?? 50;
    const pageIds = delayedIds.slice(skip, skip + take);
    const pageOrders = await prisma.order.findMany({
      where: { id: { in: pageIds } },
      include: { items: { include: { product: true } } },
    });
    const byId = new Map(pageOrders.map((o) => [o.id, o]));
    const orders = pageIds.map((id) => byId.get(id)!).filter(Boolean);
    return { orders, total: delayedIds.length };
  }

  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.scheme ? { scheme: params.scheme } : {}),
    ...(params.since || params.to
      ? { orderDate: { ...(params.since ? { gte: params.since } : {}), ...(params.to ? { lte: params.to } : {}) } }
      : {}),
    ...(params.invoicedSince || params.invoicedTo
      ? {
          parasutInvoicedAt: {
            ...(params.invoicedSince ? { gte: params.invoicedSince } : {}),
            ...(params.invoicedTo ? { lt: params.invoicedTo } : {}),
          },
        }
      : {}),
    ...matchingIdsWhere(matchingIds),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { items: { include: { product: true } } },
      orderBy: { orderDate: "desc" },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total };
}

// Siparişler sayfasındaki filtre butonlarının (Tümü / durum / Bugün Faturası Kesilenler) içine adet
// yazmak için — arama kutusundaki metin sabit tutulup (kullanıcı bir şey ararken butonlar da o arama
// içindeki dağılımı göstersin diye "cascade") her buton kendi filtresiyle ayrı ayrı sayılıyor.
export async function getOrderFilterCounts(params: {
  matchingIds?: string[] | null;
  invoicedSince: Date;
  invoicedTo: Date;
  // "Gecikenler" sekmesi zaten aktifken (page.tsx'te showDelayed=true) çağıran taraf listOrders'ı
  // AYNI matchingIds ile zaten çağırıp doğru gecikme sayısını (total) elinde tutuyor — bu durumda
  // burada AYNI (JSON rawPayload taramalı, pahalı) sorguyu tekrar çalıştırmak yerine o sayıyı
  // doğrudan kullanıyoruz (2026-09-11'de code review'da tespit edildi: iki fonksiyon paralel
  // çalıştığı için birbirinin sonucunu göremiyordu, aynı tarama iki kez yapılıyordu).
  knownDelayedCount?: number;
}) {
  const matchingIds = params.matchingIds ?? null;
  const baseWhere = matchingIdsWhere(matchingIds);

  // "total" ayrı bir COUNT(*) yerine durum gruplarının toplamından türetiliyor — Order.status
  // zorunlu (non-nullable) bir alan olduğu için bu iki değer matematiksel olarak hep eşit, ayrı
  // sorgu sadece gereksiz bir DB gidiş-dönüşüydü (2026-09-10'da code review'da tespit edildi).
  const [statusGroups, invoicedToday, delayCandidates] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
    prisma.order.count({
      where: { ...baseWhere, parasutInvoicedAt: { gte: params.invoicedSince, lt: params.invoicedTo } },
    }),
    params.knownDelayedCount != null
      ? Promise.resolve([])
      : prisma.order.findMany({
          where: { ...baseWhere, status: { notIn: [...SHIPPED_OR_DONE_STATUSES] } },
          select: { status: true, rawPayload: true },
        }),
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const g of statusGroups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }
  const delayedCount = params.knownDelayedCount ?? delayCandidates.filter((o) => getShipmentDelayInfo(o).isDelayed).length;

  return { total, byStatus, invoicedToday, delayedCount };
}

// Toast bildirimleri için — bu tarihten SONRA bizim DB'ye düşen (createdAt, yani sync'in yeni
// fark ettiği) siparişleri kalem+ürün bilgisiyle döner. orderDate değil createdAt kullanılıyor
// çünkü amaç "gerçek sipariş anı" değil "panelin yeni fark ettiği an".
export async function getRecentOrders(since: Date) {
  return prisma.order.findMany({
    where: { createdAt: { gt: since } },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export interface TopSellingProduct {
  offerId: string;
  name: string;
  image: string | null;
  revenueUsd: number;
  orderedUnits: number;
}

// "En Çok Satan Ürünler" — BİLEREK Ozon'un /v1/analytics/data uç noktası (ANALİTİK sayfasının
// "Genel Bakış" bölümü, görüntülenme/sepete ekleme gibi bizde hiç olmayan veriler için hâlâ
// kullanılıyor) yerine kendi local sipariş verimizden hesaplanıyor: (1) bu veri zaten satış
// tutarı/adet için Ozon'da senkronize edilmiş halde duruyor, ayrı bir Ozon isteğine hiç gerek yok;
// (2) Ozon'un analitik uç noktası sık sık "rate limit" (429) hatası veriyordu — kullanıcı bunu
// yaşadı (2026-09-11); (3) bizim price alanımız zaten USD, Ozon'un analitiği ise HER ZAMAN RUB
// dönüyor (bkz. src/ozon/analytics.ts) — local veri kullanmak bu ruble/dolar karışıklığını da
// kökünden çözüyor.
export async function getTopSellingProducts(params: {
  since: Date;
  to: Date;
  limit: number;
  search?: string;
}): Promise<TopSellingProduct[]> {
  const search = params.search?.trim().toLowerCase();
  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        orderDate: { gte: params.since, lte: params.to },
        status: { not: "cancelled" },
      },
      ...(search
        ? {
            OR: [
              { offerId: { contains: search, mode: "insensitive" as const } },
              { product: { name: { contains: search, mode: "insensitive" as const } } },
              { product: { nameRu: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    // Sadece ihtiyaç duyulan alanlar — `include: { product: true }` her satırda draftAttributes/
    // images gibi büyük JSON kolonları dahil TÜM ürün satırını çekiyordu, geniş tarih
    // aralıklarında gereksiz bellek/gecikme demekti (2026-09-11'de code review'da tespit edildi).
    select: {
      offerId: true,
      price: true,
      quantity: true,
      product: { select: { name: true, images: true } },
    },
  });

  const byOfferId = new Map<string, TopSellingProduct>();
  for (const item of items) {
    const revenue = Number(item.price) * item.quantity;
    const existing = byOfferId.get(item.offerId);
    if (existing) {
      existing.revenueUsd += revenue;
      existing.orderedUnits += item.quantity;
    } else {
      const images = item.product?.images;
      byOfferId.set(item.offerId, {
        offerId: item.offerId,
        name: item.product?.name ?? item.offerId,
        image: Array.isArray(images) ? ((images as string[])[0] ?? null) : null,
        revenueUsd: revenue,
        orderedUnits: item.quantity,
      });
    }
  }

  return [...byOfferId.values()].sort((a, b) => b.revenueUsd - a.revenueUsd).slice(0, params.limit);
}

// Haftalık gruplamada bir tarihin ait olduğu haftanın PAZARTESİ'sini anahtar olarak kullanıyoruz
// (gerçek ISO hafta numarası değil — takvim yılı sınırında karışıklık çıkarmayan, sıralanabilir
// basit bir "hafta başlangıcı" anahtarı yeterli).
function weekStartKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

export interface ProductSalesBucket {
  period: string; // günlükte "YYYY-MM-DD", haftalıkta o haftanın Pazartesi'si
  unitsSold: number;
  revenueUsd: number;
  avgSalePriceUsd: number;
  profitUsd: number | null; // alış fiyatı hiç girilmemişse null
}

// Ürün detay sayfasındaki "Satış Geçmişi" grafiği/tablosu için — bu ürünün geçmiş siparişlerini
// günlük/haftalık gruplayıp o dönemin satış tutarı + tahmini kârını hesaplar. Kâr, computePriceBreakdown
// ile (Fiyat Hesaplayıcı'nın kullandığı AYNI formül) o KALEMİN kendi satış fiyatı üzerinden
// hesaplanıyor — bir siparişteki diğer ürünlerin payını (gerçek kargo/komisyon gibi sipariş
// seviyesindeki verileri) tek bir ürüne bölüştürmeye çalışmak (bkz. computeOrderEstimatedProfit)
// burada anlamlı bir şekilde mümkün değil, o yüzden BİLEREK her zaman tahmini formül kullanılıyor
// (2026-09-11, kullanıcı talebi: "ürünün satış grafiğini göster ... o günlerdeki satış fiyatı ve
// karlarla birlikte").
export async function getProductSalesHistory(
  offerId: string,
  params: { since: Date; to: Date; granularity: "day" | "week" },
): Promise<ProductSalesBucket[]> {
  const [product, items] = await Promise.all([
    prisma.product.findUnique({ where: { offerId } }),
    prisma.orderItem.findMany({
      where: {
        offerId,
        order: { orderDate: { gte: params.since, lte: params.to }, status: { not: "cancelled" } },
      },
      include: { order: { select: { orderDate: true } } },
    }),
  ]);

  const buckets = new Map<string, { unitsSold: number; revenueUsd: number; profitUsd: number }>();
  for (const item of items) {
    const orderDate = item.order.orderDate;
    if (!orderDate) continue;
    const key = params.granularity === "day" ? orderDate.toISOString().slice(0, 10) : weekStartKey(orderDate);

    let profit = 0;
    if (product?.costPrice) {
      const breakdown = computePriceBreakdown(
        product.costPrice,
        product.weightGrams,
        { widthCm: product.widthCm, heightCm: product.heightCm, depthCm: product.depthCm },
        Number(item.price),
        product.heavyPackaging,
        product.cargoWeightGrams,
      );
      if (breakdown) profit = breakdown.profitUsd * item.quantity;
    }

    const existing = buckets.get(key) ?? { unitsSold: 0, revenueUsd: 0, profitUsd: 0 };
    existing.unitsSold += item.quantity;
    existing.revenueUsd += Number(item.price) * item.quantity;
    existing.profitUsd += profit;
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .map(([period, v]) => ({
      period,
      unitsSold: v.unitsSold,
      revenueUsd: v.revenueUsd,
      avgSalePriceUsd: v.unitsSold > 0 ? v.revenueUsd / v.unitsSold : 0,
      profitUsd: product?.costPrice ? v.profitUsd : null,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export async function getOrderDetail(postingNumber: string) {
  const order = await prisma.order.findUnique({
    where: { postingNumber },
    include: { items: { include: { product: true } } },
  });
  if (!order) return null;

  // FinanceTransaction, Order'a FK ile bağlı değil (bkz. schema.prisma yorumu) — manuel join.
  const transactions = await prisma.financeTransaction.findMany({
    where: { postingNumber },
    orderBy: { operationDate: "desc" },
  });

  return { ...order, transactions };
}

// Kargo Kontrolü sekmesindeki checkbox'lar için — (postingNumber, offerId) ikilileriyle gelen
// kalemleri toplu olarak işaretler/işaretini kaldırır. OrderItem'ın gerçek unique anahtarı
// (orderId, offerId) olduğundan önce postingNumber -> orderId çözülüyor.
export async function setShippingReviewed(items: Array<{ postingNumber: string; offerId: string }>, reviewed: boolean) {
  const postingNumbers = [...new Set(items.map((i) => i.postingNumber))];
  const orders = await prisma.order.findMany({
    where: { postingNumber: { in: postingNumbers } },
    select: { id: true, postingNumber: true },
  });
  const orderIdByPosting = new Map(orders.map((o) => [o.postingNumber, o.id]));

  const offerIdsByOrderId = new Map<string, string[]>();
  for (const item of items) {
    const orderId = orderIdByPosting.get(item.postingNumber);
    if (!orderId) continue;
    const list = offerIdsByOrderId.get(orderId) ?? [];
    list.push(item.offerId);
    offerIdsByOrderId.set(orderId, list);
  }

  let updated = 0;
  for (const [orderId, offerIds] of offerIdsByOrderId) {
    const result = await prisma.orderItem.updateMany({
      where: { orderId, offerId: { in: offerIds } },
      data: { shippingReviewed: reviewed },
    });
    updated += result.count;
  }
  return updated;
}

// Bizim kendi takibimiz için — tedarikçiden aldığımız alış faturasının numarası, Ozon'a gitmiyor.
export async function updatePurchaseInvoiceNumber(postingNumber: string, purchaseInvoiceNumber: string | null) {
  return prisma.order.update({ where: { postingNumber }, data: { purchaseInvoiceNumber } });
}

// Sipariş kalemlerindeki ürünlerin GTİP kodunu (varsa) önerir — draftAttributes'ta yoksa ve
// ürün zaten Ozon'a gönderilmişse canlı attribute'lardan çeker. Fatura yükleme formunu
// otomatik doldurmak için; kullanıcı isterse üzerine yazabilir.
export async function suggestHsCodesForOrder(postingNumber: string): Promise<Record<string, string>> {
  const order = await getOrderDetail(postingNumber);
  if (!order) return {};

  const suggestions: Record<string, string> = {};
  const needLiveFetch: string[] = [];

  for (const item of order.items) {
    const draft = item.product?.draftAttributes as { attributes?: Array<{ id: number; value?: string }> } | null;
    const draftDictionary = draft?.attributes?.find((a) => a.id === GTIP_DICTIONARY_ATTRIBUTE_ID)?.value;
    const draftFreeText = draft?.attributes?.find((a) => a.id === GTIP_FREE_TEXT_ATTRIBUTE_ID)?.value;
    const draftValue = draftDictionary ?? draftFreeText;
    if (draftValue) {
      suggestions[item.offerId] = extractGtipCode(draftValue);
    } else if (item.product?.ozonProductId) {
      needLiveFetch.push(item.offerId);
    }
  }

  if (needLiveFetch.length > 0) {
    try {
      const { result } = await getProductAttributes(needLiveFetch);
      for (const entry of result) {
        const dictionaryAttr = entry.attributes.find((a: { id: number }) => a.id === GTIP_DICTIONARY_ATTRIBUTE_ID);
        const freeTextAttr = entry.attributes.find((a: { id: number }) => a.id === GTIP_FREE_TEXT_ATTRIBUTE_ID);
        const value = dictionaryAttr?.values?.[0]?.value ?? freeTextAttr?.values?.[0]?.value;
        if (value) suggestions[entry.offer_id] = extractGtipCode(value);
      }
    } catch {
      // canlıdan çekilemedi — kullanıcı elle girer
    }
  }

  return suggestions;
}

export interface SubmitOzonInvoiceParams {
  postingNumber: string;
  fileBase64: string;
  number: string;
  date: string;
  price: number;
  priceCurrency: string;
  hsCodes: OzonHsCode[];
}

// Ozon'un TR→RU KDV iadesi/gümrük "proforma fatura" akışı — önce dosyayı yükleyip url alıyoruz,
// sonra bu url'i fatura bilgileriyle (no/tarih/tutar/GTİP) siparişe bağlıyoruz.
export async function submitOzonInvoice(params: SubmitOzonInvoiceParams) {
  const { url } = await uploadInvoiceFile({ postingNumber: params.postingNumber, base64Content: params.fileBase64 });
  await createOrUpdateInvoice({
    postingNumber: params.postingNumber,
    url,
    hsCodes: params.hsCodes,
    date: params.date,
    number: params.number,
    price: params.price,
    priceCurrency: params.priceCurrency,
  });
  return { url };
}

export async function fetchOzonInvoice(postingNumber: string) {
  try {
    const { result } = await getInvoice(postingNumber);
    // Ozon, hiç fatura yüklenmemiş olsa bile boş/varsayılan bir obje dönüyor
    // (file_url: "", date: null, price: 0) — gerçek bir fatura var mı yok mu, file_url'in
    // dolu olup olmadığına bakarak anlıyoruz, sadece result'un varlığına değil (2026-08-05'te
    // canlıda tespit edildi — "1.01.1970 — 0" olarak boş bir fatura gösteriliyordu).
    if (!result?.file_url) return null;
    return result;
  } catch {
    return null; // henüz fatura yüklenmemiş
  }
}

export async function removeOzonInvoice(postingNumber: string) {
  await deleteInvoice(postingNumber);
}

// shipFbsPosting'in ham cevabı beklenen `string[]` DEĞİL de eski/belgelenmemiş `{ posting_number:
// string[] }` şeklinde gelirse (bu satırlar hiç canlıda test edilmeden, sadece dokümantasyon
// araştırmasıyla yazıldı — bkz. BEKLEYEN-GELISTIRMELER.md #3) çökmesin diye savunmacı bir ayrıştırma
// — Ozon'a GERÇEK istek zaten gittikten SONRA bir ayrıştırma hatası yüzünden kilidin yanlışlıkla
// serbest bırakılıp çift sevkiyata yol açmaması için (2026-09-10'da code review'da tespit edildi).
function extractShippedPostingNumbers(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (raw && typeof raw === "object" && "posting_number" in raw) {
    const nested = (raw as { posting_number: unknown }).posting_number;
    if (Array.isArray(nested)) return nested.filter((x): x is string => typeof x === "string");
  }
  return [];
}

// shipOrder'ın attığı hataları ikiye ayırmak için: BU sınıfla sarmalanan hatalar ya Ozon'a GERÇEK
// bir ship isteği hiç gitmeden oluştu, ya da Ozon isteği AÇIKÇA (belirsizlik olmadan) reddetti —
// her iki durumda da kilit zaten serbest bırakıldı, siparişe kesinlikle hiçbir şey olmadı.
// Sarmalanmamış hatalar ("belirsiz" durumlar — bkz.
// shipFbsPosting'in kendi hata bloğu) farklı, daha temkinli bir mesajla gösterilmeli. Ship API
// route'u bu ayrımı kullanıcıya yansıtıyor — aksi halde her hata "Ozon panelinden kontrol edin"
// gibi gereksiz yere ürkütücü bir mesaj gösteriyordu, oysa çoğu durumda (ör. Ozon'un net bir
// "POSTING_DOES_NOT_HAVE_MULTI_BOX_PRODUCT" gibi isimli reddi) hiçbir belirsizlik yok
// (2026-09-11'de gerçek bir siparişte yaşandı — kullanıcı gereksiz yere korktu).
export class SafeShipFailureError extends Error {
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "SafeShipFailureError";
  }
}

// shipOrder içinde iki ayrı yerden çağrılıyordu (2026-09-10'da code review'da tespit edildi) — tek
// yerden, kilidin serbest bırakılma mantığının ileride tutarsız güncellenmesini önlemek için.
function releaseShipClaim(postingNumber: string) {
  return prisma.order.updateMany({
    where: { postingNumber, shipClaimedAt: { not: null } },
    data: { shipClaimedAt: null },
  });
}

// Sipariş birden fazla kutuya bölünecekse (multiBoxQty > 1) ürün adetlerini kutulara dağıtır.
// ÖNEMLİ (2026-09-11'de gerçek bir siparişte yaşanan POSTING_DOES_NOT_HAVE_MULTI_BOX_PRODUCT
// hatası + Ozon'un resmi dokümantasyonuyla doğrulandı): bölme için AYRI bir "multiboxqty/set"
// çağrısı YAPILMAZ — o uç nokta bambaşka bir senaryo için (bkz. src/ozon/orders.ts setMultiBoxQty
// açıklaması, kaldırıldı). Doğru yöntem: shipFbsPosting'in `packages` dizisine BİRDEN FAZLA eleman
// göndermek — Ozon'un resmi örneği tam bu senaryo için (2 adet aynı üründen oluşan bir siparişi 2
// kutuya bölmek), her package'a 1'er adet koyarak. Burada birimleri (her adet ayrı) round-robin
// dağıtıyoruz ki farklı ürünler varsa bile kutular dengeli dolsun.
// DİKKAT: bu fonksiyon birden fazla FARKLI ürünün tek bir kutuya karışabileceği bir dağıtım
// yapıyor (round-robin, ürün ayrımı gözetmeden). Ozon'un resmi dokümantasyonundaki `packages`
// dizisi örneği bunu destekliyor gibi görünüyor ve GERÇEK bir canlı testte (2026-09-11, tek
// ürünlü sipariş 71019016-0179-1, 2 kutu) başarıyla çalıştı — ama o test TEK ürünlüydü. Birden
// fazla FARKLI ürün içeren bir siparişte kutu bölme henüz canlıda doğrulanmadı; eğer Ozon karışık
// kutulara da MULTI_BOX_PRODUCT benzeri bir hatayla itiraz ederse (2026-09-11'deki yanlış
// multiboxqty/set denemesindeki gibi) bu fonksiyon gözden geçirilmeli.
function distributeIntoPackages(
  items: Array<{ product_id: number; quantity: number }>,
  boxCount: number,
): Array<{ products: Array<{ product_id: number; quantity: number }> }> {
  const units: number[] = [];
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) units.push(item.product_id);
  }
  const boxes: Map<number, number>[] = Array.from({ length: boxCount }, () => new Map());
  units.forEach((productId, i) => {
    const box = boxes[i % boxCount];
    box.set(productId, (box.get(productId) ?? 0) + 1);
  });
  return boxes.map((box) => ({
    products: [...box.entries()].map(([product_id, quantity]) => ({ product_id, quantity })),
  }));
}

// Ozon panelindeki "Topla" ile aynı adım — siparişi awaiting_packaging'den bir sonraki duruma
// geçirir ve kargo etiketinin oluşmasını tetikler (bkz. BEKLEYEN-GELISTIRMELER.md #3, kullanıcı
// notu: etiket ANCAK bu adımdan sonra oluşuyor).
export async function shipOrder(postingNumber: string, multiBoxQty?: number) {
  if (multiBoxQty != null && (!Number.isInteger(multiBoxQty) || multiBoxQty < 1)) {
    throw new Error("Geçersiz kutu sayısı — 1 ya da daha büyük bir tam sayı olmalı.");
  }

  const order = await prisma.order.findUnique({
    where: { postingNumber },
    include: { items: true },
  });
  if (!order) {
    throw new Error("Sipariş bulunamadı");
  }
  if (order.items.length === 0) {
    throw new Error("Bu siparişte hiç kalem yok — paketlenemez, önce siparişi yeniden senkronize edin.");
  }
  const missingSku = order.items.find((item) => item.ozonSku == null);
  if (missingSku) {
    throw new Error(
      `"${missingSku.offerId}" kaleminin Ozon SKU bilgisi eksik — bu siparişi güvenle paketleyemiyoruz, önce siparişi yeniden senkronize edin.`,
    );
  }

  // Kilit için BİLEREK "status" alanı DEĞİL, ayrı bir shipClaimedAt alanı kullanılıyor: 15
  // dakikada bir çalışan sync cron'u (syncFbsOrders) status'ü Ozon'dan gelen gerçek değerle EZİYOR
  // — kilit status'e yazılsaydı cron onu silip, çift tıklama korumasını devre dışı bırakabilirdi
  // (2026-09-10'da code review'da tespit edildi; Paraşüt fatura kilidi de aynı sebeple ayrı bir
  // alan — parasutInvoiceId — kullanıyor).
  const claim = await prisma.order.updateMany({
    where: { postingNumber, status: "awaiting_packaging", shipClaimedAt: null },
    data: { shipClaimedAt: new Date() },
  });
  if (claim.count === 0) {
    // order.status kilit denemesinden ÖNCE okunmuştu — kilidin neden başarısız olduğunu doğru
    // yansıtmıyordu (özellikle iki eşzamanlı istekte kaybeden isteğin hata mesajı yanıltıcı
    // oluyordu, 2026-09-10'da code review'da tespit edildi). Güncel satırı tekrar okuyoruz.
    const currentOrder = await prisma.order.findUnique({ where: { postingNumber } });
    throw new Error(
      `Bu sipariş "Topla" için uygun durumda değil (mevcut durum: ${currentOrder?.status ?? "bilinmiyor"}${currentOrder?.shipClaimedAt ? ", kilitli" : ""}) — ya zaten paketlenmiş, ya az önce başka bir istekle paketleniyor ya da önceki bir deneme belirsiz kaldı (Ozon panelinden kontrol edilmesi gerekiyor).`,
    );
  }

  // Kilit alındıktan SONRA kalemleri tekrar okuyoruz — sync cron'u (ya da elle "Senkronize Et")
  // ilk okuma ile burası arasında ozonSku/adet güncellemiş olabilir; Ozon'a gidecek gerçek istek
  // en güncel veriyle kurulmalı (2026-09-10'da code review'da tespit edildi).
  const freshItems = await prisma.orderItem.findMany({ where: { orderId: order.id } });
  if (freshItems.length === 0) {
    await releaseShipClaim(postingNumber);
    throw new Error("Bu siparişte hiç kalem yok — paketlenemez, önce siparişi yeniden senkronize edin.");
  }
  const staleSku = freshItems.find((item) => item.ozonSku == null);
  if (staleSku) {
    await releaseShipClaim(postingNumber);
    throw new Error(`"${staleSku.offerId}" kaleminin Ozon SKU bilgisi eksik — sipariş paketlenmedi.`);
  }
  // BigInt -> Number dönüşümü, güvenli tam sayı sınırını (Number.MAX_SAFE_INTEGER) aşarsa sessizce
  // yuvarlanıp Ozon'a yanlış bir product_id gönderebilirdi (2026-09-10'da code review'da tespit
  // edildi) — Ozon SKU'ları pratikte çok daha küçük olsa da açıkça kontrol ediyoruz.
  const unsafeSku = freshItems.find((item) => item.ozonSku! > BigInt(Number.MAX_SAFE_INTEGER));
  if (unsafeSku) {
    await releaseShipClaim(postingNumber);
    throw new Error(`"${unsafeSku.offerId}" kaleminin Ozon SKU değeri beklenenden çok büyük — güvenle gönderilemiyor, sipariş paketlenmedi.`);
  }

  const productItems = freshItems.map((item) => ({ product_id: Number(item.ozonSku), quantity: item.quantity }));
  const totalUnits = productItems.reduce((sum, item) => sum + item.quantity, 0);
  if (multiBoxQty != null && multiBoxQty > totalUnits) {
    await releaseShipClaim(postingNumber);
    throw new Error(`Bu siparişte toplam ${totalUnits} adet var — ${multiBoxQty} kutuya bölünemez.`);
  }
  const packages = multiBoxQty != null && multiBoxQty > 1 ? distributeIntoPackages(productItems, multiBoxQty) : [{ products: productItems }];

  let shipResult: unknown;
  try {
    const response = await shipFbsPosting({ postingNumber, packages });
    shipResult = response.result;
    console.log(`[shipOrder] ${postingNumber} shipFbsPosting ham cevap:`, JSON.stringify(shipResult));
  } catch (shipError) {
    // shipFbsPosting'in KENDİSİ hata verdi — retry KAPALI olduğu için (bkz. ozonPost'taki
    // retry:false) isteğin Ozon'a ulaşıp ulaşmadığı BELİRSİZ. İlk yazımda burada hemen
    // getFbsPosting ile "hâlâ awaiting_packaging mi" diye bakıp kilidi ona göre serbest
    // bırakıyorduk — ama Ozon'un durum güncellemesi ANINDA olmuyor olabilir (bu dosyada başka
    // yerde de not edildiği gibi, etiket bile ship'ten "kısa süre sonra" oluşuyor); şipFbsPosting
    // aslında başarılı olmuş olsa bile hemen sorulan getFbsPosting hâlâ eski "awaiting_packaging"
    // değerini dönebilir ve kilit YANLIŞLIKLA serbest bırakılıp GERÇEK bir çift sevkiyata yol
    // açabilirdi (2026-09-10'da code review'da tespit edildi). Bu yüzden artık SADECE Ozon'un
    // isteği hiç İŞLEMEDİĞİNİ gösteren AÇIK bir doğrulama hatası (400 gibi bir client-error — Ozon
    // isteği senkron olarak, hiç işlemeden reddetti demektir) varsa kilit serbest bırakılıyor;
    // belirsiz her durumda (network hatası, 5xx, zaman aşımı) kilit BİLEREK kilitli bırakılıyor —
    // yanlış tarafta hata yapmak zorundaysak, güvenli taraf bu.
    // 409 (Conflict) bilerek dışarıda bırakıldı — bazı API'lerde bu kod "zaten işlenmiş/durum
    // çakışması" anlamına gelir, yani Ozon isteği aslında işlemiş OLABİLİR; o yüzden 409'u da
    // belirsiz sayıp kilidi kilitli bırakıyoruz (2026-09-10'da code review'da tespit edildi — ilk
    // yazımda tüm 4xx'ler körlemesine "kesin reddedildi" sayılıyordu).
    const definitelyRejectedByOzon =
      shipError instanceof OzonApiError &&
      shipError.status !== undefined &&
      shipError.status >= 400 &&
      shipError.status < 500 &&
      shipError.status !== 409;
    if (definitelyRejectedByOzon) {
      // Ozon isteği AÇIKÇA reddetti (400 gibi, 409 hariç) — belirsizlik yok, kilidi güvenle serbest
      // bırakıyoruz. SafeShipFailureError ile sarmalanıyor ki API route'u bunu "belirsiz, Ozon
      // panelinden kontrol edin" değil, "kesinlikle güvenli, tekrar deneyebilirsiniz" olarak
      // göstersin (2026-09-11'de gerçek bir siparişte yaşandı — POSTING_DOES_NOT_HAVE_MULTI_BOX_PRODUCT
      // gibi net bir red bile eskiden gereksiz yere korkutucu gösteriliyordu).
      await releaseShipClaim(postingNumber);
      throw new SafeShipFailureError(shipError);
    }
    console.error(
      `[shipOrder] ${postingNumber}: shipFbsPosting belirsiz bir hatayla başarısız oldu (Ozon'a isteğin ulaşıp ulaşmadığı bilinmiyor) — sipariş BİLEREK kilitli bırakıldı, Ozon panelinden elle kontrol edilmeli. Gerçekten paketlenmediyse bkz. src/scripts/clear-stuck-ship-claim.ts.`,
      shipError,
    );
    throw shipError;
  }

  // shipFbsPosting hata FIRLATMADI — Ozon isteği kabul etti demektir. Buradan sonraki her şey
  // (cevabı yorumlama, local DB'yi güncelleme) best-effort'tur; hiçbiri kilidi geri almaz, hiçbiri
  // yukarı fırlatmaz (bir önceki denemede TAM BURADA bir ayrıştırma hatası kilidi yanlışlıkla
  // serbest bırakıyordu, 2026-09-10'da code review'da tespit edildi).
  const postingNumbers = extractShippedPostingNumbers(shipResult);
  // ORİJİNAL posting HER ZAMAN senkronize edilecekler listesinde — boş/beklenmedik bir cevap
  // gelirse zaten tek başına kullanılıyor; bölünmüş bir cevapta Ozon'un döndüğü yeni posting
  // numaraları BAZEN orijinali içermeyebilir (ör. son eki değişmiş olabilir) — bu durumda orijinal
  // hiç YENİDEN ÇEKİLMEZ, sadece aşağıdaki kör "awaiting_deliver" yedeğine güvenilirdi ve
  // rawPayload'ı bayat kalırdı (2026-09-11'de code review'da tespit edildi).
  // Set ile tekilleştiriliyor — Ozon'un ham cevabında aynı posting numarası iki kez geçerse
  // (hiç canlı doğrulanmadı, teorik bir ihtimal) aşağıdaki paralel döngü aynı sipariş satırına
  // eşzamanlı iki ayrı upsert/update göndermesin diye (2026-09-11'de code review'da tespit edildi).
  const postingsToSync = [...new Set(postingNumbers.includes(postingNumber) ? postingNumbers : [postingNumber, ...postingNumbers])];

  // Ozon'a GERÇEKTEN paketlendi bildirildikten sonra, kullanıcı 15 dakikalık sync cron'unu
  // beklemeden yeni posting'leri (bölünmüşse HER BİRİNİ, kendi kalemleriyle) hemen görebilsin diye
  // anında senkronize ediyoruz — syncFbsOrders'ın kullandığı AYNI upsertPostingIntoDb fonksiyonuyla
  // (2026-09-11, kullanıcı talebi: "sync yapıp barkodlarını o ekrana çeksek" — bölünen her yeni
  // posting artık Siparişler listesinde ANINDA, tam bir satır olarak görünüyor, "yeni sipariş" gibi
  // ayrı ayrı). Bu adımlardan hiçbiri kilidi geri almaz/yukarı fırlatmaz — Ozon'a GERÇEK istek
  // zaten gitti, buradan sonrası best-effort; biri başarısız olursa bir sonraki sync cron turu
  // (~15 dakika) yine de düzeltir. Postingler BİRBİRİNDEN BAĞIMSIZ olduğu için paralel çekiliyor
  // (2026-09-11'de code review'da tespit edildi — art arda beklemek, çok kutuya bölünen bir
  // siparişte kullanıcıyı gereksiz yere N kat bekletiyordu).
  const syncResults = await Promise.allSettled(
    postingsToSync.map(async (pn) => {
      const { result: fresh } = await getFbsPosting(pn);
      if (pn === postingNumber && fresh.status === "awaiting_packaging") {
        // Ozon'un durum güncellemesi ANINDA olmayabilir — ORİJİNAL posting için ship'ten hemen
        // sonra sorulan bu değer hâlâ ESKİ (paketlenmeden önceki) durumu yansıtıyor olabilir.
        // Bunu olduğu gibi yazarsak GERÇEKTEN paketlenmiş bir siparişi yanlışlıkla "hâlâ
        // awaiting_packaging" gösterip shipClaimedAt kilidiyle birleşince kalıcı "kilitli"
        // görünümüne yol açardı (2026-09-10'da code review'da tespit edildi) — bu durumda
        // ham/muhtemelen bayat veriyi YAZMIYORUZ, iyimser "awaiting_deliver"e düşüyoruz. Yeni
        // (bölünmeden doğan) posting'lerde bu özel durum söz konusu değil, doğrudan upsert ediliyor.
        console.log(`[shipOrder] ${pn} paketlendi ama Ozon hâlâ eski durumu (awaiting_packaging) dönüyor — muhtemelen gecikme, iyimser değer yazılıyor`);
        await prisma.order.update({ where: { postingNumber: pn }, data: { status: "awaiting_deliver" } });
      } else {
        await upsertPostingIntoDb(fresh);
      }
    }),
  );
  syncResults.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[shipOrder] ${postingsToSync[i]} paketlendi ama hemen senkronize edilemedi — bir sonraki sync cron turunda düzelecek:`, r.reason);
    }
  });
  // BİLEREK KOŞULSUZ: sadece "promise reddedildiyse" kontrol etmek yetmiyordu — Ozon'un cevabında
  // status alanı beklenmedik şekilde boş/tanımsız gelirse (hiç canlı doğrulanmadı) getFbsPosting
  // BAŞARIYLA döner ama upsertPostingIntoDb'nin update'i status:undefined ile Prisma tarafından
  // sessizce atlanır — promise "fulfilled" görünür ama local durum hâlâ "awaiting_packaging" kalırdı
  // (2026-09-11'de code review'da tespit edildi). "status: awaiting_packaging" koşulu zaten bu
  // updateMany'yi no-op yapıyor eğer senkron gerçekten başarılıysa — koşulsuz çağırmak güvenli.
  await prisma.order
    .updateMany({ where: { postingNumber, status: "awaiting_packaging" }, data: { status: "awaiting_deliver" } })
    .catch(() => {});

  return { postingNumbers, syncedPostings: postingsToSync };
}

// ETGB salt-okunur — Ozon/kargo firması otomatik oluşturuyor, biz sadece siparişin tarihi
// etrafında bir aralık verip posting_number'a göre eşleşeni buluyoruz. Henüz oluşmamışsa
// (kargo süreci tamamlanmadıysa) null döner — bu bir hata değil, zamanla gelir.
export async function fetchEtgbForOrder(postingNumber: string, orderDate: Date | null) {
  const anchor = orderDate ?? new Date();
  const dateFrom = new Date(anchor.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const dateTo = new Date(anchor.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { result } = await getEtgbDeclarations({ dateFrom, dateTo });
    return result.find((r) => r.posting_number === postingNumber) ?? null;
  } catch {
    return null;
  }
}
