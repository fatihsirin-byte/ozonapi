import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { parasut2Get, parasut2Post, parasut2Put } from "./aladdinClient";
import { buildSalesInvoicePrintUrl } from "./client";
import { findEInvoicePreferences, submitEInvoiceJob, pollEInvoiceJob, findActiveEInvoice, EInvoiceJobTimeoutError } from "./aladdinEInvoice";
import { getUsdToTryRate } from "../pricing/fx-rate";
import { getIstanbulTodayRangeUtc, toIstanbulDateString } from "../utils/istanbulTime";
import { transliterateRussian } from "../utils/transliterate";

// Aladdin Turkey Dış Ticaret Limited Şirketi'nin (Paraşüt company id 604472) Fatih Gezgin'e
// (Ozon'a satış yapan tarafın kendi şirketi, Paraşüt'te zaten kayıtlı bir kontak) her gün kestiği
// İÇ (şirketler arası) fatura — kullanıcı talebi (2026-09-16): "her gün saat 5 te ... o gün 'bugün
// kesilenler'de olan ürünlerin satış faturasını keseceğiz. aladdin den fatih gezgine. cogs
// fiyatlarımıza %40 ekleyerek satacağız ... biz ozona satış yapan şirketin alışlarını
// kesiyoruz yani."
//
// Bu akış, Aladdin'in Paraşüt hesabında Fatih Gezgin'e ZATEN kesilmiş 8 gerçek faturadan
// (2025-12'den beri, en sonuncusu 2026-08-26) doğrulanan şekli TABAN olarak kullanıyor: TL, %1
// KDV, is_abroad=false, item_type "invoice" — sales_invoice ÖNCE bu 8 örnekle BİREBİR AYNI şekilde
// oluşturuluyor.
//
// GÜNCELLEME (2026-09-17'de canlıda tespit edildi, kullanıcı doğrulaması): Fatih Gezgin'in
// Paraşüt'teki cari kartı artık bir e-Fatura mükellefi kaydı taşıyor — bu 8 örnek faturanın
// kesildiği tarihte (en sonuncusu 2026-08-26) BÖYLE DEĞİLDİ. Karşı taraf e-Fatura mükellefiyken
// düz fatura kesilemediği için (Paraşüt faturayı numarasız bir "taslak"ta bırakıyor, ne
// tamamlanıyor ne reddediliyor) — sales_invoice oluşturulduktan SONRA AYRICA bir e-Fatura'ya
// dönüştürülüyor (bkz. aladdinEInvoice.ts, eArchives.ts'teki e-Arşiv adımıyla AYNI desen). Fatih
// Gezgin ileride e-Fatura mükellefiyetinden çıkarsa (ya da bu YENİ bir kontağa kesiliyorsa) bu adım
// kendiliğinden atlanır — bkz. findEInvoicePreferences.
//
// SADECE ELLE tetiklenir (2026-09-16, kullanıcı kararı: "önce elle/manuel buton" — birkaç gün
// sonuçlar doğrulanınca otomatik 17:00 cron'a geçilecek).

// Aladdin'in Paraşüt hesabında ZATEN kayıtlı olan Fatih Gezgin kontağı (vergi no 61060090608,
// contact id doğrudan Paraşüt panelinden doğrulandı) — yeniden aranıp oluşturulmuyor.
const FATIH_GEZGIN_CONTACT_ID = "1052686564";
// Kullanıcı talebi: "cogs fiyatlarımıza %40 ekleyerek satacağız".
const MARKUP_MULTIPLIER = 1.4;
// Kullanıcı talebi: "alış fiyatı boş olan ürünlere fallback olarak 5 dolar atabiliriz".
const FALLBACK_COST_USD = 5;
// Kullanıcı talebi: "%1" KDV — Aladdin↔Fatih Gezgin arasındaki gerçek faturalarla doğrulandı.
const VAT_RATE = 1;
// Bir claim bu süreden eskiyse artık GEÇERSİZ sayılır — süreç bu claim'i temizlemeden çökerse/
// yeniden başlarsa (ör. pm2 restart) sipariş sonsuza dek "claim'li" takılı kalıp bir daha asla
// faturalanamazdı (2026-09-16 code review round 3'te tespit edildi).
//
// DİKKAT (round 5'te tespit edildi): ürün araması/oluşturması bir ara TAM PARALEL (Promise.all)
// çalıştırılmıştı ama bu, çok sayıda farklı ürün olduğunda TÜM istekleri AYNI ANDA Paraşüt'e
// göndererek hız sınırına (rate limit) takılıp canlıda gerçek bir hataya yol açtı (kullanıcı
// bulgusu: "toplu fatura denedim kesemedim ... Try again in 10 seconds"). Bunun üzerine SIRALI
// hale getirilmişti, ama o zaman da TERSİ sorun oluştu: N farklı ürün varsa toplam süre O(N)
// zincire çıkıyor, bu da CLAIM_STALE_MS'i aşıp AYNI siparişlerin ikinci kez claim edilip GERÇEKTEN
// iki fatura kesilmesi riskini artırıyordu (round 5'te tespit edildi). Şimdiki çözüm ORTA YOL:
// PRODUCT_BATCH_SIZE kadar ürün birlikte (paralel), aralarında PRODUCT_BATCH_DELAY_MS bekleyerek —
// hem Paraşüt'ü aynı anda çok sayıda istekle boğmuyor hem de toplam süreyi ~O(N/PRODUCT_BATCH_SIZE)
// ile sınırlı tutuyor. Örnek: 90 farklı ürün, grup başı ~1sn (istek + gecikme) ⇒ ~30 grup ⇒ ~30sn —
// 10 dakikalık payın çok altında, art arda birkaç 429 olsa bile.
const PRODUCT_BATCH_SIZE = 3;
const PRODUCT_BATCH_DELAY_MS = 400;
const CLAIM_STALE_MS = 10 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// items'ı `limit` kadarlık gruplar halinde, gruplar arasında `delayMs` bekleyerek işler — TAM
// paralel (rate limit riski) ile TAM sıralı (claim penceresi çok uzar) arasındaki orta yol.
async function mapWithBatchedConcurrency<T, R>(items: T[], limit: number, delayMs: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.all(batch.map(fn))));
    if (i + limit < items.length) await sleep(delayMs);
  }
  return results;
}

export class AladdinInvoiceError extends Error {}

export interface AladdinInvoiceLinePreview {
  offerId: string;
  name: string;
  quantity: number;
  unitCostUsd: number;
  unitPriceTry: number;
  usedFallbackCost: boolean;
}

export interface AladdinInvoicePreview {
  lines: AladdinInvoiceLinePreview[];
  postingNumbers: string[];
  totalTry: number;
  fxRate: number;
  // Önizlemenin hangi GÜNE ait olduğunu (TSİ, "YYYY-MM-DD") panelin gösterebilmesi için — route.ts
  // geçici olarak "bugün" dışında bir gün isteyebiliyor (PREVIEW_DAYS_AGO), kullanıcı gerçek,
  // geri alınamaz bir fatura onaylamadan önce HANGİ günü onayladığını net görsün diye eklendi.
  dateLabel: string;
}

function parseCostUsd(rawCostPrice: string | null | undefined): { costUsd: number; usedFallback: boolean } {
  const parsed = rawCostPrice ? Number(rawCostPrice) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return { costUsd: parsed, usedFallback: false };
  }
  return { costUsd: FALLBACK_COST_USD, usedFallback: true };
}

interface OrderWithItems {
  postingNumber: string;
  items: Array<{ offerId: string; quantity: number; product: { name: string; costPrice: string | null } | null }>;
}

// Ya belirli bir sipariş listesi (kullanıcının önizlemede ONAYLADIĞI TAM KÜME — bkz.
// createDailyAladdinInvoice) ya da bir tarih aralığı (sadece önizleme için) ile sipariş çeker —
// İKİSİ DE aynı satır/tutar hesaplama mantığına (summarizeOrders) girer, tek yerden.
async function loadOrdersForInvoice(selector: { postingNumbers: string[] } | { range: { start: Date; end: Date } }): Promise<OrderWithItems[]> {
  if ("postingNumbers" in selector) {
    if (selector.postingNumbers.length === 0) return [];
    return prisma.order.findMany({
      where: { postingNumber: { in: selector.postingNumbers } },
      include: { items: { include: { product: true } } },
    });
  }
  return prisma.order.findMany({
    where: { parasutInvoicedAt: { gte: selector.range.start, lt: selector.range.end } },
    include: { items: { include: { product: true } } },
  });
}

function summarizeOrders(orders: OrderWithItems[], rate: number): { lines: AladdinInvoiceLinePreview[]; totalTry: number } {
  const byOfferId = new Map<string, AladdinInvoiceLinePreview>();
  for (const order of orders) {
    for (const item of order.items) {
      const { costUsd, usedFallback } = parseCostUsd(item.product?.costPrice ?? null);
      const unitPriceTry = Number((costUsd * MARKUP_MULTIPLIER * rate).toFixed(2));
      const existing = byOfferId.get(item.offerId);
      if (existing) {
        existing.quantity += item.quantity;
        continue;
      }
      byOfferId.set(item.offerId, {
        offerId: item.offerId,
        name: transliterateRussian(item.product?.name ?? item.offerId),
        quantity: item.quantity,
        unitCostUsd: costUsd,
        unitPriceTry,
        usedFallbackCost: usedFallback,
      });
    }
  }
  const lines = [...byOfferId.values()];
  const totalTry = Number(lines.reduce((sum, l) => sum + l.unitPriceTry * l.quantity, 0).toFixed(2));
  return { lines, totalTry };
}

// O gün (TSİ) müşteriye (Ozon) fatura kesilen siparişlerin ürünlerini, aynı üründen olanları TEK
// satırda toplayarak (adet toplanır) özetler — gerçek faturayı kesmeden önce kullanıcıya
// gösterilecek bir önizleme. Hiçbir şey OLUŞTURMAZ, hiçbir Aladdin/Fatih Gezgin isteği ATMAZ.
export async function buildDailyAladdinInvoicePreview(range?: { start: Date; end: Date }): Promise<AladdinInvoicePreview> {
  const effectiveRange = range ?? getIstanbulTodayRangeUtc();
  const orders = await loadOrdersForInvoice({ range: effectiveRange });
  const rate = await getUsdToTryRate();
  if (!rate) throw new AladdinInvoiceError("Güncel USD/TL kuru alınamadı, tekrar deneyin.");
  const { lines, totalTry } = summarizeOrders(orders, rate);
  return {
    lines,
    postingNumbers: orders.map((o) => o.postingNumber),
    totalTry,
    fxRate: rate,
    dateLabel: toIstanbulDateString(effectiveRange.start),
  };
}

// Paraşüt her fatura satırında bir "Ürün/Hizmet" kaydı istiyor — bkz. orderInvoice.ts
// findOrCreateParasutProduct'taki AYNI gerekçe (o fonksiyon paylaşılamıyor çünkü
// parasutGet/Post/Put'a — Fatih Gezgin'in hesabına — bağlı, burada Aladdin'in KENDİ kataloğu için
// tekrarlanıyor). AYNI DERS de tekrarlanıyor: Paraşüt fatura PDF'inde satır adını bizim
// "description"ımızdan değil, bağlı ÜRÜN kaydının KENDİ "name" alanından basıyor — bu yüzden var
// olan kayıt bulunduğunda adı güncel değilse Paraşüt'te güncelleniyor (2026-09-16 code review'da
// "bu resenkronizasyon eksik" tespitine karşılık — ilk yazımda unutulmuştu).
async function findOrCreateAladdinProduct(offerId: string, name: string, unitPriceTry: number): Promise<string> {
  const existing = await parasut2Get<{ data: Array<{ id: string; attributes: { name: string; code: string; vat_rate: number; unit: string; list_price: number; currency: string } }> }>(
    `products?filter[code]=${encodeURIComponent(offerId)}`,
  );
  if (existing.data.length > 0) {
    const product = existing.data[0];
    if (product.attributes.name !== name) {
      try {
        await parasut2Put(`products/${product.id}`, {
          data: {
            id: product.id,
            type: "products",
            attributes: {
              name,
              code: product.attributes.code,
              vat_rate: product.attributes.vat_rate,
              unit: product.attributes.unit,
              list_price: product.attributes.list_price,
              currency: product.attributes.currency,
            },
          },
        });
      } catch (err) {
        console.error(`[aladdin-invoice] Ürün adı güncellenemedi (product ${product.id}, offerId ${offerId}):`, err);
      }
    }
    return product.id;
  }

  const created = await parasut2Post<{ data: { id: string } }>("products", {
    data: {
      type: "products",
      attributes: { name, code: offerId, vat_rate: VAT_RATE, unit: "Adet", list_price: unitPriceTry, currency: "TRL" },
    },
  });
  return created.data.id;
}

export interface AladdinInvoiceResult {
  invoiceId: string;
  invoiceNo: string | null;
  postingNumbers: string[];
  totalTry: number;
  // Kullanıcı talebi (2026-09-16): "fatura kesince fatura linkli görüntüleme butonu gözükecek
  // mi?" — orderInvoice.ts'teki AYNI desen (printUrl), sadece Aladdin'in company id'siyle.
  printUrl: string;
  // "approved": Paraşüt/GİB e-Faturayı onayladı, invoiceNo GERÇEK e-Fatura numarası. "pending":
  // e-Fatura'ya dönüştürme adımı başlatıldı ama GİB onayı henüz gelmedi (Paraşüt panelinden takip
  // edilmeli) — bu durumda invoiceNo geçici bir yer tutucu olabilir. "failed": kontak e-Fatura
  // mükellefi ama dönüştürme adımı hata verdi — sales_invoice GERÇEKTEN oluştu (silinemez) ama
  // e-Fatura'ya dönüşmedi, Paraşüt panelinden elle tamamlanmalı. "not_required": kontak e-Fatura
  // mükellefi değil, eskisi gibi düz fatura yeterli (bkz. findEInvoicePreferences).
  eInvoiceStatus: "approved" | "pending" | "failed" | "not_required";
  eInvoiceError: string | null;
}

// SADECE bu çağrının kendi claimId'sine ait satırları serbest bırakır — başka bir (eşzamanlı)
// çağrının claim'ine ASLA dokunmaz (2026-09-16 code review round 2'de tespit edildi: sabit bir
// sentinel string kullanan ilk sürümde, kaybeden bir eşzamanlı istek kazananın claim'ini
// silebiliyor, bu da kazananın gerçek faturasının numarasının hiç kaydedilmemesine ve o
// siparişlerin YENİDEN faturalanabilir hale gelmesine yol açabiliyordu). HEM erken hata
// çıkışlarında ("bu deneme başarısız oldu, tekrar denenebilsin") HEM de faturanın BAŞARIYLA
// kesildiği yolun sonunda ("iş bitti, claim işaretini temizle" — bkz. createDailyAladdinInvoice'un
// finally bloğu, round 4'te tek yere toplandı) kullanılıyor; ikinci kullanımda isim biraz yanıltıcı
// olsa da davranış tam istenen: sadece claim işaretini temizler, purchaseInvoiceNumber'a dokunmaz.
async function releaseClaim(postingNumbers: string[], claimId: string): Promise<void> {
  await prisma.order
    .updateMany({
      where: { postingNumber: { in: postingNumbers }, aladdinInvoiceClaimId: claimId },
      data: { aladdinInvoiceClaimId: null, aladdinInvoiceClaimedAt: null },
    })
    .catch((err) => {
      console.error("[aladdin-invoice] Claim geri açılamadı:", err);
    });
}

// GERÇEK, geri alınamaz bir Paraşüt satış faturası oluşturur (Aladdin'in hesabında). SADECE ELLE
// tetiklenir (bkz. app/api/aladdin-invoice/route.ts) — otomatik bir cron YOK (kullanıcı kararı:
// önce birkaç gün elle test edilip doğrulanacak).
//
// `postingNumbers` BİLEREK zorunlu — kullanıcının önizleme ekranında GÖRÜP ONAYLADIĞI TAM KÜME
// budur. Burada YENİDEN tarih aralığı sorgulamıyoruz: önizleme ile gerçek kesim arasında geçen
// sürede yeni bir sipariş faturalanmış olabilir, o siparişi SESSİZCE dahil etmek kullanıcının
// onayladığı tutardan FARKLI, daha büyük bir fatura kesilmesine yol açardı (2026-09-16 code
// review'da tespit edildi). Yeni sipariş varsa bir sonraki çalıştırmada (aynı gün tekrar
// tetiklenirse ya da ertesi günkü otomatik/elle turda) zaten yakalanır.
export async function createDailyAladdinInvoice(postingNumbersInput: string[]): Promise<AladdinInvoiceResult> {
  // Mükerrer kayıt varsa (2026-09-16 code review round 2'de tespit edildi) claim sayısı ASLA
  // istenen uzunluğa erişemez, her istek yanlışlıkla "başka bir istek başlatmış" sanılırdı.
  const postingNumbers = [...new Set(postingNumbersInput)];
  if (postingNumbers.length === 0) {
    throw new AladdinInvoiceError("Fatura kesilecek sipariş listesi boş.");
  }

  const orders = await loadOrdersForInvoice({ postingNumbers });

  // Var olmayan/yazım hatalı bir sipariş numarası (ör. önizleme ile kesim arasında silinmiş/yeniden
  // adlandırılmış) claim sorgusunda ASLA eşleşmeyeceğinden, aşağıdaki "claim.count !== length"
  // kontrolü onu eşzamanlı bir istekle karıştırıp yanıltıcı bir hata verirdi (2026-09-16 code
  // review round 3'te tespit edildi) — burada AYRICA, net bir mesajla kontrol ediyoruz.
  const foundPostingNumbers = new Set(orders.map((o) => o.postingNumber));
  const missing = postingNumbers.filter((p) => !foundPostingNumbers.has(p));
  if (missing.length > 0) {
    throw new AladdinInvoiceError(`Şu sipariş numaraları bulunamadı: ${missing.join(", ")} — önizlemeyi yenileyip tekrar deneyin.`);
  }

  const rate = await getUsdToTryRate();
  if (!rate) throw new AladdinInvoiceError("Güncel USD/TL kuru alınamadı, tekrar deneyin.");
  const { lines, totalTry } = summarizeOrders(orders, rate);
  if (lines.length === 0) {
    throw new AladdinInvoiceError("Kesilecek bir şey bulunamadı.");
  }

  // Çift tıklama / iki açık sekme / iki eşzamanlı istek aynı siparişleri görüp GERÇEK, ayrı iki
  // fatura kesmesin diye — faturayı kesmeden ÖNCE ilgili TÜM siparişleri atomik olarak, BU ÇAĞRIYA
  // ÖZGÜ rastgele bir kimlikle (claimId) claim ediyoruz. Hepsi claim edilemezse (biri zaten
  // GEÇERLİ bir claim'e sahipse ya da zaten bir alış faturası numarası varsa), güvenli tarafta
  // kalıp geri çekiliyoruz. purchaseInvoiceNumber'IN KENDİSİ kilit için KULLANILMIYOR — o alan
  // kullanıcının elle düzenleyebildiği ayrı bir alan (bkz. schema.prisma yorumu, 2026-09-16 code
  // review round 2). ESKİ (CLAIM_STALE_MS'ten daha eski) bir claim GEÇERSİZ sayılıp üzerine
  // yazılabiliyor — bkz. CLAIM_STALE_MS yorumu (round 3).
  const claimId = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);
  const claim = await prisma.order.updateMany({
    where: {
      postingNumber: { in: postingNumbers },
      purchaseInvoiceNumber: null,
      OR: [{ aladdinInvoiceClaimId: null }, { aladdinInvoiceClaimedAt: { lt: staleBefore } }],
    },
    data: { aladdinInvoiceClaimId: claimId, aladdinInvoiceClaimedAt: new Date() },
  });
  if (claim.count !== postingNumbers.length) {
    await releaseClaim(postingNumbers, claimId);
    throw new AladdinInvoiceError(
      "Bu siparişler için fatura kesme işlemi az önce başka bir istekle başlatılmış olabilir (ya da bazılarının zaten bir alış faturası numarası var) — sayfayı yenileyip tekrar deneyin.",
    );
  }

  let invoiceId: string;
  let invoiceNo: string | null;
  let eInvoiceStatus: AladdinInvoiceResult["eInvoiceStatus"] = "not_required";
  let eInvoiceError: string | null = null;
  let eInvoicePrintUrl: string | null = null;
  try {
    // KÜÇÜK GRUPLAR HALİNDE, aralarında kısa bir bekleme ile — bkz. PRODUCT_BATCH_SIZE/
    // PRODUCT_BATCH_DELAY_MS yorumu (round 5): ne TAM paralel (rate limit'e takılır) ne TAM sıralı
    // (claim penceresi çok uzayıp ikinci bir claim'in devreye girmesine yol açabilir).
    const details = await mapWithBatchedConcurrency(lines, PRODUCT_BATCH_SIZE, PRODUCT_BATCH_DELAY_MS, async (line) => {
      const productId = await findOrCreateAladdinProduct(line.offerId, line.name, line.unitPriceTry);
      return { quantity: line.quantity, unit_price: line.unitPriceTry, vat_rate: VAT_RATE, description: line.name, productId };
    });

    const issueDate = new Date().toISOString().slice(0, 10);
    // Aladdin↔Fatih Gezgin arasındaki 8 gerçek faturayla BİREBİR aynı şekil: item_type "invoice",
    // TL, is_abroad false, invoice_note YOK, e-Arşiv/e-Fatura adımı YOK ("plain" fatura). Fatura
    // numarasını BİLEREK kendimiz atamıyoruz — bu "plain" fatura türünde (e-Arşiv/GİB adımı
    // olmadığı için) Paraşüt invoice_no'yu OLUŞTURMA ANINDA kesinleştiriyor, Ozon-fatura
    // akışındaki gibi (bkz. orderInvoice.ts) sonradan yeniden numaralandırma YOK.
    const invoiceRes = await parasut2Post<{ data: { id: string; attributes: { invoice_no?: string } } }>("sales_invoices", {
      data: {
        type: "sales_invoices",
        attributes: {
          item_type: "invoice",
          issue_date: issueDate,
          due_date: issueDate,
          currency: "TRL",
          is_abroad: false,
          description: `Günlük ürün maliyeti — ${issueDate}`,
        },
        relationships: {
          contact: { data: { id: FATIH_GEZGIN_CONTACT_ID, type: "contacts" } },
          details: {
            data: details.map((d) => ({
              type: "sales_invoice_details",
              attributes: {
                quantity: d.quantity,
                unit_price: d.unit_price,
                vat_rate: d.vat_rate,
                description: d.description,
              },
              relationships: {
                product: { data: { id: d.productId, type: "products" } },
              },
            })),
          },
        },
      },
    });

    invoiceId = invoiceRes.data.id;
    const plainInvoiceNo = invoiceRes.data.attributes.invoice_no || null;

    // Fatih Gezgin'in cari kartı e-Fatura mükellefi kaydı taşıyorsa (bkz. dosya başı yorumu,
    // 2026-09-17), sales_invoice'ı BURADA e-Fatura'ya dönüştürüyoruz — kontak e-Fatura mükellefi
    // DEĞİLSE (findEInvoicePreferences null döner) bu adım TAMAMEN atlanır, eskisi gibi düz fatura
    // yeterli sayılır.
    let realInvoiceNo: string | null = null;
    // findEInvoicePreferences'ı AYRI bir try/catch'te çağırıyoruz (2026-09-17 code review'da tespit
    // edildi): burası sadece kontağın e-Fatura mükellefi OLUP OLMADIĞINI okuyor, henüz hiçbir
    // dönüştürme denemesi YAPILMADI — bu adım geçici bir ağ/Paraşüt hatasıyla başarısız olursa,
    // aşağıdaki asıl dönüştürme bloğuyla AYNI catch'e düşüp kullanıcıya yanıltıcı şekilde
    // "e-Fatura'ya dönüştürme adımı başarısız oldu" denmemeli — hiçbir dönüştürme denenmedi,
    // sadece mükellefiyet durumu ÖĞRENİLEMEDİ.
    let eInvoicePrefs: Awaited<ReturnType<typeof findEInvoicePreferences>>;
    try {
      eInvoicePrefs = await findEInvoicePreferences(FATIH_GEZGIN_CONTACT_ID);
    } catch (err) {
      eInvoicePrefs = null;
      eInvoiceStatus = "pending";
      eInvoiceError = "Fatih Gezgin'in e-Fatura mükellefiyet durumu okunamadı — Paraşüt panelinden kontrol edin.";
      console.error(`[aladdin-invoice] e-Fatura mükellefiyet durumu okunamadı (invoiceId ${invoiceId}):`, err);
    }
    try {
      // eInvoicePrefs null ise iki durumdan biri: (a) kontak GERÇEKTEN e-Fatura mükellefi değil
      // (eInvoiceStatus zaten varsayılan "not_required"te kaldı), (b) yukarıdaki okuma başarısız
      // oldu (eInvoiceStatus zaten "pending" + net bir hata mesajıyla işaretlendi) — ikisinde de
      // burada YAPILACAK bir şey yok, dönüştürme denemesi atlanır.
      if (eInvoicePrefs) {
        const jobId = await submitEInvoiceJob(invoiceId, eInvoicePrefs.scenario, eInvoicePrefs.to);
        await pollEInvoiceJob(jobId);
        const active = await findActiveEInvoice(invoiceId);
        if (active?.status === "approved" && active.invoiceNumber) {
          eInvoiceStatus = "approved";
          realInvoiceNo = active.invoiceNumber;
          if (active.printableUrl) eInvoicePrintUrl = active.printableUrl;
        } else if (active?.status === "approved") {
          // "approved" ama invoice_number BOŞ — normalde birlikte gelmesi beklenen iki alan
          // tutarsız (2026-09-17 code review'da tespit edildi: aksi halde burada sessizce
          // PARASUT_ID yer tutucusunu GERÇEK numaraymış gibi "onaylandı" diye gösterirdik). Gerçek
          // durumu bilmediğimiz için iyimser "approved" yerine temkinli "pending" sayıp
          // loglayarak elle kontrol edilebilir hale getiriyoruz.
          eInvoiceStatus = "pending";
          console.error(
            `[aladdin-invoice] UYARI: e-Fatura durumu "approved" ama invoice_number boş geldi (invoiceId ${invoiceId}) — Paraşüt panelinden kontrol edin.`,
          );
        } else if (active?.status === "refused") {
          eInvoiceStatus = "failed";
          eInvoiceError = "Paraşüt/GİB e-Faturayı reddetti — Paraşüt panelinden kontrol edin.";
        } else {
          // "waiting"/"pending" — Paraşüt tarafında e-Fatura kaydı oluştu ama GİB onayı henüz
          // gelmedi (e-Arşiv'deki PDF gecikmesiyle AYNI türden bir bekleme, bkz. eArchives.ts) —
          // bu BAŞARISIZLIK değil, sadece henüz kesinleşmemiş demek.
          eInvoiceStatus = "pending";
        }
      }
    } catch (err) {
      if (err instanceof EInvoiceJobTimeoutError) {
        // Paraşüt tarafı süresinde YANIT VERMEDİ — bu bir BAŞARISIZLIK değil, iş muhtemelen hâlâ
        // sürüyor (bkz. aladdinEInvoice.ts'teki pollEInvoiceJob yorumu); "failed" değil "pending"
        // olarak işaretleyip kullanıcıyı Paraşüt panelinden kontrol etmeye yönlendiriyoruz.
        eInvoiceStatus = "pending";
        console.error(`[aladdin-invoice] e-Fatura işi zaman aşımına uğradı (invoiceId ${invoiceId}):`, err);
      } else {
        // e-Fatura'ya DÖNÜŞTÜRME başarısız oldu — ama sales_invoice KENDİSİ GERÇEKTEN oluştu
        // (silinemez), bu yüzden burada işlemi GERİ ALMIYORUZ/claim'i iptal ETMİYORUZ; kullanıcıya
        // "e-Fatura adımı başarısız" diye bildirip Paraşüt panelinden elle tamamlamasını istiyoruz —
        // orderInvoice.ts'teki eArchiveFailed ile AYNI felsefe.
        eInvoiceStatus = "failed";
        eInvoiceError = err instanceof Error ? err.message : String(err);
        console.error(`[aladdin-invoice] e-Fatura dönüştürme başarısız (invoiceId ${invoiceId}):`, err);
      }
    }

    // Doküman/ilk 8 örnekte (e-Fatura mükellefi OLMAYAN bir kontağa) invoice_no HER ZAMAN oluşturma
    // anında dolu geldi, ama bunu KÖR güvenle varsaymıyoruz — hiçbiri dolu gelmezse invoiceId'ye
    // (Paraşüt'teki KALICI, birincil kimlik) düşüyoruz ki purchaseInvoiceNumber ASLA null'a geri
    // dönmesin (null'a dönmesi, GERÇEKTEN kesilmiş bu faturayı "hiç kesilmemiş" gibi gösterip
    // siparişlerin YENİDEN faturalanmasına yol açardı — 2026-09-16 code review round 2'de tespit
    // edildi). e-Fatura onaylanmışsa GERÇEK e-Fatura numarası (realInvoiceNo) her zaman öncelikli.
    invoiceNo = realInvoiceNo || plainInvoiceNo || `PARASUT_ID:${invoiceId}`;
  } catch (err) {
    // Fatura oluşturma BAŞARISIZ oldu — claim'i geri açıp tekrar denenebilir hale getiriyoruz.
    await releaseClaim(postingNumbers, claimId);
    throw err;
  }

  // Kullanıcı talebi: "buradan oluşan fatura numarasını da ilgili siparişlerin alış faturası no'ya
  // ekleyeceğiz" — o gün faturalanan TÜM siparişler AYNI (konsolide) fatura numarasını paylaşıyor.
  // Sadece BİZİM CLAIM'İMİZE ait (aladdinInvoiceClaimId: claimId) VE hâlâ boş olan
  // purchaseInvoiceNumber alanları güncelleniyor — kullanıcı bu pencerede o siparişlerden birinin
  // "Alış Fatura No" alanını elle doldurduysa, o değerin ÜZERİNE YAZILMIYOR (2026-09-16 code
  // review round 2'de tespit edildi). Claim işareti ise, purchaseInvoiceNumber yazılabilsin ya da
  // yazılamasın FARK ETMEKSİZİN her durumda temizleniyor — aksi halde o nadir durumdaki sipariş
  // sonsuza kadar "claim'li" takılı kalırdı. Bu son adım başarısız olursa (ör. geçici DB hatası)
  // GERÇEK fatura zaten oluşmuş olduğundan hatayı yutmuyoruz ama loglayıp kullanıcıya YİNE DE
  // başarı sonucunu döndürüyoruz — invoiceId/invoiceNo burada kayıtlı, gerekirse elle eşleştirilebilir.
  try {
    const finalized = await prisma.order.updateMany({
      where: { postingNumber: { in: postingNumbers }, aladdinInvoiceClaimId: claimId, purchaseInvoiceNumber: null },
      // eInvoiceStatus/eInvoiceError BURADA, kalıcı olarak kaydediliyor — önceden sadece bu
      // fonksiyonun tek seferlik HTTP yanıtında vardı, sunucu yeniden başlarsa ya da kullanıcı
      // sayfayı kapatırsa "pending"/"failed" durumundaki GERÇEK bir faturanın takip edilmesi
      // gerektiği bilgisi tamamen kaybolurdu (2026-09-17 code review'da tespit edildi).
      data: { purchaseInvoiceNumber: invoiceNo, aladdinEInvoiceStatus: eInvoiceStatus, aladdinEInvoiceError: eInvoiceError },
    });
    // Hata FIRLATILMASA bile (Prisma updateMany 0 satır eşleşse de başarıyla döner) beklenenden AZ
    // satır güncellenmiş olabilir. En olası sebep bu sipariş(ler)in bu pencerede kullanıcı
    // tarafından elle "Alış Fatura No" alanına yazılması (bkz. yukarıki `purchaseInvoiceNumber:
    // null` koruması) — ama TEK sebep bu değil: CLAIM_STALE_MS'ten daha uzun süren, son derece
    // nadir bir durumda claim'in başka bir çağrı tarafından "çalınmış" olması da AYNI belirtiyi
    // verir (round 4'te tespit edildi, bkz. CLAIM_STALE_MS yorumu) — bu durumda gerçekte İKİ ayrı
    // fatura kesilmiş olabilir. Fatura zaten kesilmiş olduğundan bunu sessizce geçmek yerine
    // loglayıp elle incelenebilir hale getiriyoruz (2026-09-16 code review round 3'te "sadece
    // exception'da loglanıyor, sessiz uyuşmazlıkta değil" bulgusuna karşılık).
    if (finalized.count !== postingNumbers.length) {
      console.error(
        `[aladdin-invoice] UYARI: fatura kesildi (invoiceId ${invoiceId}, invoiceNo ${invoiceNo}) ama ${postingNumbers.length} siparişten sadece ${finalized.count} tanesine yazılabildi — ya biri bu sırada elle "Alış Fatura No" alanına yazıldı, ya da (çok nadir) claim çok uzun sürüp başka bir istekle çakıştı; ikinci durumda GERÇEKTEN İKİ fatura kesilmiş olabilir, Paraşüt panelinden kontrol edin. Sipariş(ler): ${postingNumbers.join(", ")}`,
      );
    }
  } catch (err) {
    console.error(
      `[aladdin-invoice] KRİTİK: fatura kesildi (invoiceId ${invoiceId}, invoiceNo ${invoiceNo}) ama purchaseInvoiceNumber yazılamadı, sipariş(ler): ${postingNumbers.join(", ")}`,
      err,
    );
  } finally {
    // Aynı where/data şeklini releaseClaim'den AYRI tekrar yazmak yerine onu çağırıyoruz — ikisi
    // (2026-09-16 code review round 4'e kadar) birbirinden bağımsız kopyalardı, biri değişip
    // diğeri unutulabilirdi.
    await releaseClaim(postingNumbers, claimId);
  }

  // e-Fatura GİB tarafından onaylandıysa Paraşüt'ün kendi verdiği resmi "printable_url"ü tercih
  // ediyoruz (e-Fatura'nın gerçek görünümü, düz faturanın /print şablonundan FARKLI olabilir) —
  // henüz onaylanmadıysa ya da e-Fatura gerekmiyorsa eskisi gibi genel /print linkine düşülür.
  const printUrl = eInvoicePrintUrl ?? buildSalesInvoicePrintUrl(env.parasut2CompanyId ?? "", invoiceId);
  return { invoiceId, invoiceNo, postingNumbers, totalTry, printUrl, eInvoiceStatus, eInvoiceError };
}
