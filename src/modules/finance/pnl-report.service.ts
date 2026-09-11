import { prisma } from "../../db/prisma";
import { computeBillingWeightGrams } from "../../pricing/formula";
import { getUsdToRubRate } from "../../pricing/fx-rate";

// Fiyat formülüyle (src/pricing/formula.ts) aynı oranlar — kalem bazlı kâr/zarar raporunda
// (UI tablosu + CSV indirme) hem canlı sayı hem CSV formülü olarak kullanılıyor, tek yerden
// (2026-08-24, kullanıcı talebi: "fiyat formülünde zaten var gerekli metrik ve değişkenler").
const COMMISSION_RATE = 0.05;
const LOGISTICS_SERVICE_RATE = 0.02;
const LOGISTICS_SERVICE_CAP_USD = 200 / 75; // 200 RUB tavanı, formula.ts'teki USD_TO_RUB_RATE ile aynı kur
const BANK_FEE_RATE = 0.019;

export interface PnlRow {
  postingNumber: string;
  orderDate: string | null; // ISO yyyy-mm-dd
  status: string;
  offerId: string;
  productName: string;
  productNameRu: string | null;
  productImage: string | null;
  ozonProductId: string | null;
  ozonSku: string | null;
  quantity: number;
  unitSalePrice: number;
  unitCostPrice: number | null;
  weightSource: "measured" | "estimated" | "unknown";
  cargoWeightGrams: number | null;
  netWeightGrams: number | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  // Ozon'un o posting için GERÇEKTEN kestiği kargo ücreti (₽, RUB) — sadece teslimattan sonra
  // dolar (bkz. finance.service.ts açıklaması). Posting'te tek ürün varsa tutarın tamamı, birden
  // fazla farklı ürün varsa satış tutarı payına göre ORANTILI dağıtılmış hali (approximatePosting
  // true ise bu bir yaklaşık paylaştırma — Ozon kalem bazında ayrım vermiyor).
  realShippingRub: number | null;
  // realShippingRub'ın güncel (o an çekilmiş) USD/RUB kuruyla $'a çevrilmiş hali — kâr/zarar
  // hesabında (computeRowMetrics) tahmini $ formülün YERİNE bu kullanılır. Kur çekilemezse
  // (ağ hatası) null kalır ve tahmini formüle düşülür — bkz. pricing/fx-rate.ts.
  realShippingUsd: number | null;
  approximateShippingSplit: boolean;
  shippingReviewed: boolean;
  // Ozon'un GERÇEKTEN kestiği komisyon+diğer ücretler (₽) — realShippingRub ile AYNI mantık
  // (posting'te tek ürün varsa tamamı, birden fazla varsa satış payına göre paylaştırılmış).
  // bkz. pnl-report.service.ts sumRealFeesRub (2026-09-11, kullanıcı talebi: "komisyon banka
  // gideri iç dağıtım vs düşmüyor" — PNL sayfası da sipariş sayfası gibi artık gerçek veriyi
  // kullanıyor, tahmini sabit oran (%5+%2+%1.9) sadece gerçek veri yokken devreye giriyor).
  realFeesRub: number | null;
  realFeesUsd: number | null;
}

export interface MissingCostPriceGroup {
  offerId: string;
  productName: string;
  productNameRu: string | null;
  productImage: string | null;
  ozonProductId: string | null;
  ozonSku: string | null;
  orderCount: number;
}

// Alış fiyatı boş kalemleri SİPARİŞ SATIRI değil ÜRÜN bazında gruplar — aynı ürünün onlarca
// sipariş satırı varsa hepsi için ayrı ayrı "gir" tıklamak yerine bir kere girilip hepsine
// yansısın diye (2026-09-09, kullanıcı talebi: "ürün bazlı bir kere doldur, aynı üründen bi
// sürü varsa tıkladığımda listeden kaldır"). costPrice zaten Product üzerinde tutulduğu için
// bir ürün için girilince bu grup bir sonraki yüklemede kendiliğinden listeden düşer.
export function groupMissingCostPrice(rows: PnlRow[]): MissingCostPriceGroup[] {
  const map = new Map<string, MissingCostPriceGroup>();
  for (const row of rows) {
    if (row.unitCostPrice != null) continue;
    const existing = map.get(row.offerId);
    if (existing) {
      existing.orderCount += 1;
    } else {
      map.set(row.offerId, {
        offerId: row.offerId,
        productName: row.productName,
        productNameRu: row.productNameRu,
        productImage: row.productImage,
        ozonProductId: row.ozonProductId,
        ozonSku: row.ozonSku,
        orderCount: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.orderCount - a.orderCount);
}

export interface PnlRowMetrics {
  totalSale: number;
  totalCost: number | null;
  shipping: number | null;
  // commission/logistics/bankFee HER ZAMAN tahmini sabit oranla hesaplanır (kullanıcının CSV'de
  // oranları değiştirip "ne olurdu" denemesi için — bkz. buildPnlCsv). Kâr hesabında (profit) bu
  // üçünün toplamı DEĞİL, feesUsd kullanılır — Ozon gerçek kesintiyi işlediyse feesUsd o gerçek
  // tutar, işlemediyse yine bu üçünün toplamıdır (2026-09-11, kullanıcı talebi).
  commission: number;
  logistics: number;
  bankFee: number;
  feesUsd: number;
  profit: number | null;
  marginPct: number | null;
  warning: string | null;
}

// Kullanıcı isteği: ağırlığı elle güncellediği (tartılmış) ürünlerde o gerçek ağırlığı,
// güncellemediklerinde var olan (paketleme payı eklenmiş "inflated") ağırlığı kullan. Bu ayrım
// zaten Product.cargoWeightGrams alanında kodlu — weightConfirmed=true olduğunda gerçek
// tartılmış değere eşitleniyor (bkz. products.service.ts confirmRealWeight), aksi halde
// formülün hesapladığı inflated değer orada duruyor. Burada sadece mevcut cargoWeightGrams
// kullanılıyor, yoksa weightGrams'tan aynı formülle (computeBillingWeightGrams) türetiliyor.
export function effectiveCargoWeightGrams(product: {
  weightGrams: number | null;
  cargoWeightGrams: number | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  heavyPackaging: boolean;
} | null): number | null {
  if (!product) return null;
  if (product.cargoWeightGrams != null) return product.cargoWeightGrams;
  if (product.weightGrams == null) return null;
  return computeBillingWeightGrams(
    product.weightGrams,
    product.widthCm,
    product.heightCm,
    product.depthCm,
    product.heavyPackaging,
  );
}

// Bir posting'e ait FinanceTransaction satırlarındaki deliveryCharge'ları toplar. Ozon bunu
// kesinti olarak (genelde negatif) döndürüyor — burada mutlak değer, yani pozitif bir "maliyet"
// olarak dönülüyor. Teslimattan ÖNCE de posting için küçük düzeltme işlemleri (transaction satırı)
// oluşabiliyor ama deliveryCharge o satırlarda 0 kalıyor (bkz. finance.service.ts açıklaması) —
// bu yüzden "veri var mı" kontrolü satır varlığına değil, toplamın 0'dan büyük olmasına bakıyor;
// aksi halde henüz kargo kesintisi işlenmemiş siparişler yanlışlıkla "gerçek veri var" sayılırdı.
export function sumRealShippingRub(transactions: Array<{ deliveryCharge: number | null }>): number | null {
  const total = transactions.reduce((sum, t) => sum + Math.abs(t.deliveryCharge ?? 0), 0);
  return total > 0 ? total : null;
}

// commissionAmount + otherCharges'ı BİRLİKTE topluyoruz — bu hesapta Ozon'un "satış komisyonu"
// accrual tipi (bkz. finance.service.ts SALE_COMMISSION_TYPE_ID) neredeyse hep 0 geliyor, gerçek
// komisyona karşılık gelen kalemler ("RfbsGlobalAgentFee", "BrandCommission" gibi) sınıflandırılamayıp
// otherCharges'a düşüyor — o yüzden ikisini ayrı tutmak yanlış (çok düşük) bir "gerçek komisyon"
// gösterirdi. Satır bazında ABS ALMADAN (Math.abs), önce toplayıp SONRA işaretine bakıyoruz — bazı
// satırlar ("MarketplaceRedistributionOfAcquiringOperation") birbirini götüren +/- çift olarak
// geliyor; satır bazında abs alsaydık bu çiftler yanlışlıkla iki kat gerçek gider sayılırdı
// (2026-09-11, kullanıcı talebi: "komisyon banka gideri iç dağıtım vs düşmüyor" — aslında hiç
// kullanılmıyordu, sadece sabit tahmini oranla değiştiriliyordu).
export function sumRealFeesRub(transactions: Array<{ commissionAmount: number | null; otherCharges: number | null }>): number | null {
  const total = transactions.reduce((sum, t) => sum + (t.commissionAmount ?? 0) + (t.otherCharges ?? 0), 0);
  return total < 0 ? -total : null;
}

// Siparişler listesindeki "Olası Net Kâr" hesabı için — Ozon gerçek kargo/komisyon kesintisini
// işlediyse (teslimattan sonra) tahmini yerine bunları kullanır (2026-09-10/11, kullanıcı talebi).
// bkz. src/modules/orders/orders.service.ts computeOrderEstimatedProfit. İkisi de AYNI
// FinanceTransaction satırlarına ihtiyaç duyduğu için tek sorguda birlikte dönüyor — önceden ayrı
// iki fonksiyon aynı postingNumber'lar için sorguyu iki kere atıyordu (2026-09-11'de code
// review'da tespit edildi).
export async function getRealShippingAndFeesUsdByPosting(
  postingNumbers: string[],
): Promise<{ shipping: Map<string, number>; fees: Map<string, number> }> {
  const shipping = new Map<string, number>();
  const fees = new Map<string, number>();
  if (postingNumbers.length === 0) return { shipping, fees };

  const [transactions, usdToRubRate] = await Promise.all([
    prisma.financeTransaction.findMany({ where: { postingNumber: { in: postingNumbers } } }),
    getUsdToRubRate(),
  ]);
  if (!usdToRubRate) return { shipping, fees };

  const byPosting = new Map<string, typeof transactions>();
  for (const t of transactions) {
    const list = byPosting.get(t.postingNumber) ?? [];
    list.push(t);
    byPosting.set(t.postingNumber, list);
  }
  for (const [postingNumber, txs] of byPosting) {
    const shippingRub = sumRealShippingRub(txs);
    if (shippingRub != null) shipping.set(postingNumber, shippingRub / usdToRubRate);
    const feesRub = sumRealFeesRub(txs);
    if (feesRub != null) fees.set(postingNumber, feesRub / usdToRubRate);
  }
  return { shipping, fees };
}

// DB'de o an ne kadar sipariş geçmişi varsa hepsini kalem bazında döner (canlı Ozon
// senkronizasyonu YAPMAZ — bu ayrı, bkz. src/scripts/export-pnl-csv.ts; UI/route hızlı kalsın
// diye sadece daha önce senkronize edilmiş veriyi okur).
export async function getPnlRows(params?: { since?: Date; to?: Date }): Promise<PnlRow[]> {
  const orders = await prisma.order.findMany({
    where: {
      // Kâr/zarar sadece GERÇEKLEŞMİŞ satışları yansıtsın diye iptal edilen ve henüz
      // tamamlanmamış (kargoda vb.) siparişler hariç tutuluyor (2026-09-09, kullanıcı talebi:
      // "sadece delivered olanlar gelecek").
      status: "delivered",
      ...(params?.since || params?.to
        ? { orderDate: { ...(params.since ? { gte: params.since } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    },
    include: { items: { include: { product: true } } },
    orderBy: { orderDate: "asc" },
  });

  const usdToRubRate = await getUsdToRubRate();
  const postingNumbers = orders.map((o) => o.postingNumber);
  const transactions = postingNumbers.length > 0
    ? await prisma.financeTransaction.findMany({ where: { postingNumber: { in: postingNumbers } } })
    : [];
  const transactionsByPosting = new Map<string, typeof transactions>();
  for (const t of transactions) {
    const list = transactionsByPosting.get(t.postingNumber) ?? [];
    list.push(t);
    transactionsByPosting.set(t.postingNumber, list);
  }

  const rows: PnlRow[] = [];
  for (const order of orders) {
    const orderTransactions = transactionsByPosting.get(order.postingNumber) ?? [];
    const realShippingTotalRub = sumRealShippingRub(orderTransactions);
    const realFeesTotalRub = sumRealFeesRub(orderTransactions);
    const distinctOfferIds = new Set(order.items.map((i) => i.offerId));
    const approximateShippingSplit = distinctOfferIds.size > 1;
    const orderTotalSale = order.items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

    for (const item of order.items) {
      const product = item.product;
      let realShippingRub: number | null = null;
      if (realShippingTotalRub != null) {
        if (!approximateShippingSplit) {
          realShippingRub = realShippingTotalRub;
        } else if (orderTotalSale > 0) {
          const itemSale = Number(item.price) * item.quantity;
          realShippingRub = realShippingTotalRub * (itemSale / orderTotalSale);
        }
      }
      let realFeesRub: number | null = null;
      if (realFeesTotalRub != null) {
        if (!approximateShippingSplit) {
          realFeesRub = realFeesTotalRub;
        } else if (orderTotalSale > 0) {
          const itemSale = Number(item.price) * item.quantity;
          realFeesRub = realFeesTotalRub * (itemSale / orderTotalSale);
        }
      }
      rows.push({
        postingNumber: order.postingNumber,
        orderDate: order.orderDate ? order.orderDate.toISOString().slice(0, 10) : null,
        status: order.status,
        offerId: item.offerId,
        productName: product?.name ?? "(ürün kaydı yok)",
        productNameRu: product?.nameRu ?? null,
        productImage: Array.isArray(product?.images) ? ((product.images as string[])[0] ?? null) : null,
        ozonProductId: product?.ozonProductId ?? null,
        // Ozon'un canlı mağaza sayfası product_id ile DEĞİL sku ile açılıyor
        // (https://www.ozon.ru/context/detail/id/{sku} — Ozon'un kendi dokümantasyonunda böyle;
        // product_id ile denenince 404 verdiği 2026-09-09'da kullanıcı tarafından teyit edildi).
        ozonSku: item.ozonSku != null ? item.ozonSku.toString() : null,
        quantity: item.quantity,
        unitSalePrice: Number(item.price),
        unitCostPrice: product?.costPrice != null ? Number(product.costPrice) : null,
        weightSource: product?.weightConfirmed ? "measured" : product?.weightGrams != null ? "estimated" : "unknown",
        cargoWeightGrams: effectiveCargoWeightGrams(product),
        netWeightGrams: product?.weightGrams ?? null,
        widthCm: product?.widthCm ?? null,
        heightCm: product?.heightCm ?? null,
        depthCm: product?.depthCm ?? null,
        realShippingRub,
        realShippingUsd: realShippingRub != null && usdToRubRate != null ? realShippingRub / usdToRubRate : null,
        approximateShippingSplit,
        shippingReviewed: item.shippingReviewed,
        realFeesRub,
        realFeesUsd: realFeesRub != null && usdToRubRate != null ? realFeesRub / usdToRubRate : null,
      });
    }
  }
  return rows;
}

// Kargo Kontrolü sekmesi için: Ozon'un gerçek kargo kesintisini işlediği (yani teslimattan sonra
// finans verisi gelmiş) sipariş kalemlerini döner — henüz teslim edilmemiş / finans verisi
// gelmemiş kalemler bu sekmede hiç görünmez (bkz. getPnlRows, realShippingRub null kalıyor).
export async function getShippingReviewRows(params?: { since?: Date; to?: Date }): Promise<PnlRow[]> {
  const rows = await getPnlRows(params);
  return rows.filter((r) => r.realShippingRub != null);
}

export function estimateShippingForWeight(weightGrams: number): number {
  return weightGrams <= 500 ? 0.8 + 0.0055 * weightGrams : 3.0 + 0.5 * (weightGrams / 100);
}

// Gerçek kargo (varsa) ile ağırlıktan çıkan tahmini kargo arasındaki fark ($) — pozitifse
// gerçek maliyet tahminden fazla (fiyatlama varsayımını aşan "gizli" ek maliyet, bkz. UI'daki
// kırmızı/yeşil renklendirme), ikisinden biri yoksa null.
export function computeShippingDiffUsd(row: PnlRow): number | null {
  if (row.realShippingUsd == null || row.cargoWeightGrams == null) return null;
  const estimated = estimateShippingForWeight(row.cargoWeightGrams * row.quantity);
  return row.realShippingUsd - estimated;
}

// "Sadece zarar edilmiş kargoları göster" filtresi — gerçek kargo tahminden YÜKSEK olanlar
// (bizim açımızdan olumsuz fark). Hem UI'da (bkz. app/pnl/page.tsx) hem CSV export'ta (bkz.
// app/api/orders/pnl-report/csv/route.ts) aynı mantık kullanılsın diye tek yerden (2026-09-09,
// kullanıcı talebi: "csv her zaman filtrelere göre çalışsın").
export function filterShippingLoss(rows: PnlRow[]): PnlRow[] {
  return rows.filter((r) => (computeShippingDiffUsd(r) ?? 0) > 0);
}

// "Hatalı hesaplanan kargoları göster" — yönden bağımsız, gerçek ile tahmin arasında ANLAMLI
// bir fark olan (1 sentten büyük) her satır. "Sadece zarar edilen" (yukarıdaki) sadece bizim
// aleyhimize olan yönü gösterirken bu, ağırlık verisinin genel isabetini denetlemek için ikisini
// de kapsar (2026-09-09, kullanıcı talebi).
export function filterShippingMismatch(rows: PnlRow[]): PnlRow[] {
  return rows.filter((r) => Math.abs(computeShippingDiffUsd(r) ?? 0) > 0.01);
}

// "Mütabık olunmayan kargoları tahminle değiştir" checkbox'ı için — gerçek kargo ile tahmin
// birbirini TUTMAYAN (mismatch) satırlarda gerçek değeri yok sayıp tahmine düşürür, ki
// computeRowMetrics/summarizePnlRows o satırlarda otomatik ağırlık bazlı tahmini kullansın.
// Ham veriyi (realShippingRub/realShippingUsd) DEĞİL, sadece bu hesaplama için türetilmiş bir
// KOPYASINI değiştirir — Kargo Kontrolü sekmesi gibi başka yerler gerçek veriyi olduğu gibi
// görmeye devam eder (2026-09-09, kullanıcı talebi).
export function overrideDisputedShippingWithEstimate(rows: PnlRow[]): PnlRow[] {
  return rows.map((r) => {
    if (Math.abs(computeShippingDiffUsd(r) ?? 0) <= 0.01) return r;
    return { ...r, realShippingRub: null, realShippingUsd: null };
  });
}

// Bir satırın kâr/zarar dökümünü JS'te hesaplar — buildPnlCsv()'nin ürettiği sheet
// formülleriyle BİREBİR aynı mantık (UI tablosunda ve toplamlarda kullanılıyor).
export function computeRowMetrics(row: PnlRow): PnlRowMetrics {
  const totalSale = row.quantity * row.unitSalePrice;
  // Ozon'un GERÇEK kargo kesintisi varsa (₽, güncel kurla $'a çevrilmiş) o kullanılır — yoksa
  // (henüz Ozon işlememişse ya da o an kur çekilemediyse) ağırlık bazlı tahmini formüle
  // düşülür. DÜZELTME (2026-08-24, kullanıcı bulgusu, tahmini formül için): kargo ücreti
  // tarifesi kademeli (sabit taban + gram başı ücret) — bu yüzden önce toplam ağırlığı (birim
  // ağırlık × adet) bulup formülü TEK SEFERDE o toplam ağırlığa uygulamak gerekiyor. Eskiden
  // birim ağırlıkla hesaplanan ücret adetle çarpılıyordu, bu da $0.80/$3 sabit tabanı da adetle
  // katlayıp kargo maliyetini olması gerekenden fazla gösteriyordu.
  const shipping =
    row.realShippingUsd ?? (row.cargoWeightGrams != null ? estimateShippingForWeight(row.cargoWeightGrams * row.quantity) : null);
  const commission = totalSale * COMMISSION_RATE;
  const logistics = Math.min(row.unitSalePrice * LOGISTICS_SERVICE_RATE, LOGISTICS_SERVICE_CAP_USD) * row.quantity;
  const bankFee = totalSale * BANK_FEE_RATE;
  // Ozon'un GERÇEK komisyon+diğer kesintisi varsa (bkz. PnlRow.realFeesUsd) sabit tahmini oran
  // yerine o kullanılır — kargoda zaten yapılan aynı desen (2026-09-11, kullanıcı talebi).
  const feesUsd = row.realFeesUsd ?? commission + logistics + bankFee;

  if (row.unitCostPrice == null) {
    return {
      totalSale, totalCost: null, shipping, commission, logistics, bankFee, feesUsd, profit: null, marginPct: null,
      warning: "Alış fiyatı girilmemiş — kâr hesaplanamadı",
    };
  }
  const totalCost = row.quantity * row.unitCostPrice;
  if (shipping == null) {
    return {
      totalSale, totalCost, shipping: null, commission, logistics, bankFee, feesUsd, profit: null, marginPct: null,
      warning: "Ağırlık yok — kargo ücreti hesaplanamadı",
    };
  }
  const profit = totalSale - feesUsd - shipping - totalCost;
  const marginPct = totalCost > 0 ? (profit / totalCost) * 100 : null;
  return { totalSale, totalCost, shipping, commission, logistics, bankFee, feesUsd, profit, marginPct, warning: null };
}

export interface PnlReportTotals {
  totalSale: number;
  totalCost: number;
  shipping: number;
  commission: number;
  logistics: number;
  bankFee: number;
  // Kâr hesabında GERÇEKTEN kullanılan komisyon+diğer kesinti toplamı — bkz. PnlRowMetrics.feesUsd.
  feesUsd: number;
  profit: number;
  marginPct: number | null;
  missingCostCount: number;
}

export function summarizePnlRows(rows: PnlRow[]): PnlReportTotals {
  const totals: PnlReportTotals = {
    totalSale: 0, totalCost: 0, shipping: 0, commission: 0, logistics: 0, bankFee: 0, feesUsd: 0, profit: 0,
    marginPct: null, missingCostCount: 0,
  };
  for (const row of rows) {
    const m = computeRowMetrics(row);
    totals.totalSale += m.totalSale;
    totals.commission += m.commission;
    totals.logistics += m.logistics;
    totals.bankFee += m.bankFee;
    totals.feesUsd += m.feesUsd;
    if (m.totalCost == null) {
      totals.missingCostCount += 1;
      continue;
    }
    totals.totalCost += m.totalCost;
    totals.shipping += m.shipping ?? 0;
    totals.profit += m.profit ?? 0;
  }
  totals.marginPct = totals.totalCost > 0 ? (totals.profit / totals.totalCost) * 100 : null;
  return totals;
}

function csvEscape(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const WEIGHT_SOURCE_LABEL: Record<PnlRow["weightSource"], string> = {
  measured: "Ölçülmüş (gerçek)",
  estimated: "Tahmini (inflated)",
  unknown: "",
};

// pnl-export CLI scripti VE "CSV İndir" butonu aynı bu fonksiyonu kullanıyor — komisyon/marj/
// kargo oranlarını sheet üzerinde değiştirip anında yeniden hesaplatabilsin diye sabit sayı
// değil, canlı Google Sheets formülü üretir (2026-08-24, kullanıcı talebi).
export function buildPnlCsv(rows: PnlRow[]): string {
  const header = [
    "Sipariş No", "Sipariş Tarihi", "Durum", "Offer ID", "Ürün Adı", "Adet",
    "Birim Satış ($)", "Birim Alış ($)", "Ağırlık Kaynağı", "Kargo Ağırlığı (g)",
    "Toplam Satış ($)", "Toplam Alış ($)", "Kargo Ücreti ($)", "Komisyon ($)",
    "Lojistik Hizmet Bedeli ($)", "Banka Ücreti ($)", "Net Kâr ($)", "Marj (%)", "Uyarı",
  ];

  const csvRows: string[] = [header.map(csvEscape).join(",")];
  let rowNum = 1;

  for (const row of rows) {
    rowNum += 1;
    const metrics = computeRowMetrics(row);
    const G = `G${rowNum}`, H = `H${rowNum}`, J = `J${rowNum}`, K = `K${rowNum}`, L = `L${rowNum}`, M = `M${rowNum}`, N = `N${rowNum}`, O = `O${rowNum}`, P = `P${rowNum}`;

    const cells = [
      row.postingNumber,
      row.orderDate ?? "",
      row.status,
      row.offerId,
      row.productName,
      row.quantity,
      row.unitSalePrice,
      row.unitCostPrice ?? "",
      WEIGHT_SOURCE_LABEL[row.weightSource],
      row.cargoWeightGrams ?? "",
      `=F${rowNum}*${G}`,
      `=IF(${H}="","",F${rowNum}*${H})`,
      // Ozon'un gerçek kargo kesintisi varsa (₽'den o anki kurla çevrilmiş) sabit sayı olarak
      // yazılıyor — yoksa kademeli tahmini formül (TOPLAM ağırlık, birim ağırlık × adet,
      // üzerinden tek seferde; birim başına hesaplayıp adetle çarpmak sabit tabanı da (0.8/3)
      // katlayıp maliyeti şişiriyordu, bkz. computeRowMetrics yorumu).
      row.realShippingUsd != null
        ? row.realShippingUsd
        : `=IF(${J}="","",IF(F${rowNum}*${J}<=500,0.8+0.0055*F${rowNum}*${J},3+0.5*(F${rowNum}*${J}/100)))`,
      `=K${rowNum}*0.05`,
      `=MIN(${G}*0.02,200/75)*F${rowNum}`,
      `=K${rowNum}*0.019`,
      // Ozon'un gerçek komisyon+diğer kesintisi varsa (kargoda olduğu gibi) Net Kâr'da N/O/P
      // formüllerinin toplamı YERİNE sabit sayı olarak kullanılır — N/O/P hücreleri yine de
      // oranları elle değiştirip "ne olurdu" denemek için formül olarak kalıyor, sadece Net Kâr
      // onlara bağlı değil (2026-09-11, kullanıcı talebi: "komisyon banka gideri iç dağıtım vs
      // düşmüyor").
      row.realFeesUsd != null
        ? `=IF(${L}="","",K${rowNum}-${row.realFeesUsd}-${M}-${L})`
        : `=IF(${L}="","",K${rowNum}-N${rowNum}-${O}-${P}-${M}-${L})`,
      `=IF(OR(${L}="",${L}=0),"",Q${rowNum}/${L}*100)`,
      metrics.warning ?? "",
    ];
    csvRows.push(cells.map(csvEscape).join(","));
  }

  const lastDataRow = rowNum;
  if (lastDataRow >= 2) {
    rowNum += 1;
    const totalRow = [
      "TOPLAM", "", "", "", "", "", "", "", "", "",
      `=SUM(K2:K${lastDataRow})`,
      `=SUM(L2:L${lastDataRow})`,
      `=SUM(M2:M${lastDataRow})`,
      `=SUM(N2:N${lastDataRow})`,
      `=SUM(O2:O${lastDataRow})`,
      `=SUM(P2:P${lastDataRow})`,
      `=SUM(Q2:Q${lastDataRow})`,
      `=IF(SUM(L2:L${lastDataRow})=0,"",SUM(Q2:Q${lastDataRow})/SUM(L2:L${lastDataRow})*100)`,
      "",
    ];
    csvRows.push(totalRow.map(csvEscape).join(","));
  }

  csvRows.push("");
  csvRows.push(csvEscape("Notlar:"));
  csvRows.push(csvEscape("- Bu dosyadaki fiyat/kâr hücreleri canlı formül — komisyon/marj/kargo oranlarını hücrelerden değiştirip anında yeniden hesaplatabilirsiniz."));
  csvRows.push(csvEscape("- \"Ağırlık Kaynağı\" = Ölçülmüş: ürün sipariş ekranından tartılıp elle girilmiş gerçek ağırlık kullanıldı."));
  csvRows.push(csvEscape("- \"Ağırlık Kaynağı\" = Tahmini (inflated): ağırlık hiç güncellenmemiş, formülün paketleme payı eklediği eski tahmini ağırlık kullanıldı."));
  csvRows.push(
    csvEscape(
      "- Kargo Ücreti ve Net Kâr: Ozon o siparişin kargo/komisyon kesintisini GERÇEKTEN işlediyse (genelde teslimattan sonra) o gerçek tutar sabit sayı olarak kullanılır; işlemediyse fiyat formülündeki tahmini oranlarla hesaplanır. Komisyon/Lojistik Hizmet Bedeli/Banka Ücreti sütunları HER ZAMAN tahmini orana göredir (oranları hücrelerden değiştirip deneyebilirsiniz) — Net Kâr gerçek veri varken bu üç hücreye değil, gerçek toplam kesintiye bağlıdır.",
    ),
  );

  // BOM — Excel/Google Sheets'in UTF-8'i (Türkçe karakterler) doğru tanıması için.
  return "﻿" + csvRows.join("\n");
}
