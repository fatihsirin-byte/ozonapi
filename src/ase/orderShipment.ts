import { prisma } from "../db/prisma";
import { getOrderDetail, suggestHsCodesForOrder } from "../modules/orders/orders.service";
import { readCachedInvoicePdf, fetchAndCacheInvoicePdf } from "../parasut/pdfCache";
import { resolveInvoicePdfForOrder } from "../parasut/eArchives";
import { sendShipment, ASE_SHIPMENT_TYPE, describeAseCode, type AseShipmentProduct, type SendShipmentPayload } from "./client";
import { HSCODE_ERROR_CODE, SHIPMENT_NOT_YET_SYNCED_ERROR_CODE } from "./constants";

// Menşe ülke kodu — kullanıcı kararı (2026-09-12): sabit "TR", ekstra alan/DB değişikliği yok.
const PRODUCT_ORIGIN_COUNTRY_CODE = "TR";

// Paraşüt faturası TL (TRL) cinsinden kesiliyor (bkz. src/parasut/orderInvoice.ts createSalesInvoice
// currency: "TRL") — ASE doküman örneğinde de "TL" kullanılmış, aynı para birimi.
const INVOICE_CURRENCY_CODE = "TL";
const INVOICE_FILE_EXTENSION = "pdf";

// "2023-02-20T19:48:48.458227+03:00" gibi, sabit +03:00 ofsetli bir ISO string üretir. Türkiye
// 2016'dan beri yıl boyu UTC+3'te sabit (DST yok, bkz. src/utils/dateTr.ts'deki aynı varsayım) —
// bu yüzden basitçe 3 saat ekleyip toISOString()'in "Z"sini "+03:00" ile değiştirmek yeterli.
function toAseInvoiceDateString(date: Date): string {
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().replace("Z", "+03:00");
}

// Butona art arda hızlı tıklanması (çift tıklama, iki açık sekme) aynı sipariş için eş zamanlı
// birden fazla gönderimi tetiklemesin diye bir in-flight kilit — ikinci çağrı YENİ bir gönderim
// BAŞLATMAZ ama devam eden gönderimin AYNI promise'ini bekler (Set değil Map, 2026-09-13 code
// review'da tespit edildi): çağıran route (ase-shipment/route.ts) sendOrderToAse dönünce Order'ı
// okuyup sonucu kullanıcıya gösteriyor — eskiden ikinci çağrı hemen (iş bitmeden) dönüp henüz
// güncellenmemiş/eski satırı okutuyordu, kullanıcıya "tıklama hiçbir şey yapmadı" izlenimi verirdi.
const inFlight = new Map<string, Promise<void>>();

async function recordResult(postingNumber: string, success: boolean, message: string, errorCode: string | null = null) {
  try {
    await prisma.order.update({
      where: { postingNumber },
      data: {
        aseShipmentSentAt: new Date(),
        aseShipmentSuccess: success,
        aseShipmentMessage: message,
        aseShipmentErrorCode: success ? null : errorCode,
      },
    });
  } catch (err) {
    console.error(`[ase] Sonuç Order'a kaydedilemedi (posting ${postingNumber}):`, err);
  }
}

export interface OrderHsCodeInfo {
  offerId: string;
  productName: string;
  hsCode: string | null;
}

// "ASE'ye Gönder" butonundaki düzelt-ve-tekrar-dene popup'ının (bkz. AseShipmentButton.tsx)
// alanlarını doldurmak için — doSendOrderToAse'in kendi içindeki hsCode çözümlemesiyle (öncelik:
// Product.gtipOverride, yoksa Ozon kategori önerisi) AYNI mantığı kullanır, tek yerden (2026-09-13).
export async function resolveOrderHsCodes(postingNumber: string): Promise<OrderHsCodeInfo[]> {
  const order = await getOrderDetail(postingNumber);
  if (!order) return [];
  const suggestedHsCodes = await suggestHsCodesForOrder(postingNumber);
  return order.items.map((item) => ({
    offerId: item.offerId,
    productName: item.product?.name ?? item.offerId,
    hsCode: item.product?.gtipOverride || suggestedHsCodes[item.offerId] || null,
  }));
}

// Bir Ozon siparişini ASE'ye (gümrük/ETGB) bildirir. Kullanıcı sipariş sayfasındaki "Fatura Kes +
// ASE'ye Gönder" akışından (bkz. InvoiceAndAseButton.tsx, fatura onaylanınca otomatik tetikler) VE
// src/scripts/sync-orders-cron.ts'teki runAseAutoSend'den (2026-09-23'ten itibaren, 5 dakikada bir
// — henüz hiç denenmemiş siparişler için) çağrılır.
//
// TARİHÇE: 2026-09-13'te bu otomatik/periyodik çağrı BİLEREK kaldırılmıştı ("kullanıcı bunu
// öngörülemez bulmuştu") — o zaman fatura kesme ve ASE gönderme AYRI iki buton/adımdı. 2026-09-16'da
// akış "Fatura Kes + ASE'ye Gönder" olarak TEK bir otomatik zincire birleştirildi; kullanıcı artık
// "fatura onaylanınca ASE otomatik gitsin" davranışını İSTİYOR, sadece bunun bir tarayıcı sekmesinin
// açık kalmasına bağlı olmamasını istedi (2026-09-23, canlıda: "f5 attım ... demek ki tam
// arkaplanda çalışmıyor" bulgusu üzerine, kullanıcı onayıyla periyodik çağrı GERİ eklendi) — bu
// yüzden aşağıdaki güvenli davranış (inFlight kilidi + zaten başarılıysa atlama) hem tıklamalar hem
// periyodik cron çağrıları için AYNI korumayı sağlıyor, tekrar tekrar çağrılması ZARARSIZ.
//
// Fatura numarası KESİNLEŞMEDEN (bkz. Order.parasutInvoiceNoConfirmed) hiçbir şey yapmaz — henüz
// geçici olabilecek bir numarayı gümrüğe bildirmemek için. TASARIM GEREĞİ hiçbir zaman exception
// fırlatmaz — çağıran route/cron sonucu (isSuccess/mesaj) DB'den okuyup kullanıcıya gösterir.
export function sendOrderToAse(postingNumber: string): Promise<void> {
  const existing = inFlight.get(postingNumber);
  if (existing) return existing;
  const promise = doSendOrderToAse(postingNumber).finally(() => {
    inFlight.delete(postingNumber);
  });
  inFlight.set(postingNumber, promise);
  return promise;
}

async function doSendOrderToAse(postingNumber: string): Promise<void> {
  try {
    const order = await getOrderDetail(postingNumber);
    if (!order) {
      console.error(`[ase] Sipariş bulunamadı (posting ${postingNumber})`);
      return;
    }

    if (!order.parasutInvoiceNoConfirmed) {
      // Henüz erken — fatura numarası kesinleşmeden ASE'ye bildirim yapılmaz, sessizce dön.
      return;
    }

    if (order.aseShipmentSuccess) {
      // Daha önce başarıyla gönderildi — buton tekrar tıklansa bile ikinci bir gönderime izin
      // vermiyoruz (2026-09-13, kullanıcı talebi: gönderim artık SADECE elle, butonla yapılıyor).
      return;
    }

    if (!order.parasutInvoiceNo) {
      await recordResult(postingNumber, false, "Fatura numarası kesinleşmiş görünüyor ama parasutInvoiceNo boş");
      return;
    }

    if (!order.parasutInvoicedAt) {
      await recordResult(postingNumber, false, "Fatura tarihi (parasutInvoicedAt) eksik");
      return;
    }

    // unitPrice'ı GERÇEK faturadaki TL tutarıyla birebir eşleştirmek için, o faturada kullanılan
    // AYNI kuru kullanıyoruz (bkz. src/parasut/orderInvoice.ts — item.price USD, unitPriceTry =
    // price * parasutInvoiceFxRate). Bu alan eski (bu alan eklenmeden önce kesilmiş) faturalarda
    // boş olabilir — o durumda yanlış bir TL tutarı göndermemek için gönderimi atlıyoruz.
    if (order.parasutInvoiceFxRate == null) {
      await recordResult(postingNumber, false, "Fatura kur bilgisi (parasutInvoiceFxRate) eksik — eski bir fatura olabilir");
      return;
    }
    const fxRate = order.parasutInvoiceFxRate;

    if (order.items.length === 0) {
      await recordResult(postingNumber, false, "Siparişte kalem yok");
      return;
    }

    // PDF, fatura "hazır" göründüğü an zaten diske önbelleğe alınmış oluyor (bkz.
    // src/parasut/pdfCache.ts cacheInvoicePdfIfMissing). Görev talimatındaki "parasutPrintUrl'den
    // indir" yaklaşımı yerine BİLEREK bu önbelleği kullanıyoruz: parasutPrintUrl aslında Paraşüt'ün
    // giriş gerektiren /print sayfası (oturum çerezi olmadan sunucu tarafından indirilemez), oysa
    // pdfCache.ts zaten doğrulanmış, çalışan bir PDF kaynağı sağlıyor.
    //
    // GÜNCELLEME/DÜZELTME (2026-09-24'te canlıda tespit edildi, kullanıcı bulgusu: "hepsinin ASE'si
    // X diyor, fatura PDF'i önbellekte bulunamadı diye"): sendOrderToAse artık ASE'ye Gönder
    // butonuna/otomatik cron'a parasutInvoiceNoConfirmed true olur olmaz tetikleniyor — ama bu
    // artık PDF'in TAM hazır olduğu anlamına gelmiyor (bkz. eArchives.ts ActiveEArchiveInfo yorumu:
    // invoice_number, GİB onayından ÖNCE atanıyor). Önceden PDF'in zaten önbellekte olduğu
    // GARANTİYDİ (ASE sadece PDF "ready" olduktan sonra tetikleniyordu) — artık değil, bu yüzden
    // burada KENDİMİZ aktif olarak bir kez daha denemeliyiz. GİB hâlâ işlemdeyse (gerçek bir hata
    // DEĞİL) recordResult(false) ile KALICI bir "başarısız/X" işaretlemiyoruz — bu, kullanıcının
    // elle "Tekrar Dene"lemesini gerektirirdi; bunun yerine sessizce dönüyoruz ki runAseAutoSend
    // (aseShipmentSentAt hâlâ null olduğu için) bir sonraki turda kendiliğinden tekrar dener.
    let pdfBuffer = await readCachedInvoicePdf(postingNumber);
    if (!pdfBuffer && order.parasutInvoiceId) {
      try {
        const result = await resolveInvoicePdfForOrder(postingNumber, order.parasutInvoiceId);
        if (result.status === "ready") {
          pdfBuffer = await fetchAndCacheInvoicePdf(postingNumber, result.pdfUrl);
        }
      } catch (err) {
        console.error(`[ase] PDF'i şimdi almaya çalışırken hata (posting ${postingNumber}):`, err);
      }
    }
    if (!pdfBuffer) {
      // GİB hâlâ işlemde — GERÇEK bir hata değil, sadece henüz zamanı gelmedi. Kalıcı "başarısız"
      // işaretlemiyoruz (bkz. yukarıdaki yorum), sadece loglayıp sessizce dönüyoruz.
      console.log(`[ase] ${postingNumber}: fatura PDF'i henüz hazır değil (GİB'de işlemde olabilir), ASE gönderimi ertelendi.`);
      return;
    }
    const invoiceBase64String = pdfBuffer.toString("base64");

    // Ozon'un kendi hs_codes gönderimlerinde (bkz. suggestHsCodesForOrder) offerId bazlı öneri
    // üretiliyor — Product.gtipOverride varsa o öncelikli (kullanıcı kararı, 2026-09-12).
    const suggestedHsCodes = await suggestHsCodesForOrder(postingNumber);

    const shipmentProductList: AseShipmentProduct[] = [];
    for (const item of order.items) {
      const hsCode = item.product?.gtipOverride || suggestedHsCodes[item.offerId];
      if (!hsCode) {
        await recordResult(postingNumber, false, `GTİP (HS) kodu bulunamadı: ${item.product?.name ?? item.offerId}`, HSCODE_ERROR_CODE);
        return;
      }

      // TODO (ilk canlı testte doğrulanmalı): doküman "articleCode Ozon'dan bize gelen kodla aynı
      // olmalı" diyor — Ozon'un kendi hs_codes gönderimlerinde offerId değil ozonSku (numerik)
      // kullanılıyor (bkz. OrderItem.ozonSku açıklaması, orders.service.ts), o yüzden burada da
      // ozonSku kullanıldı. ozonSku her zaman dolu olmayabilir (eski/senkronize edilmemiş
      // kalemlerde) — o durumda offerId'ye düşülüyor, ama ASE'nin bunu kabul edip etmeyeceği
      // doğrulanmadı.
      const articleCode = item.ozonSku != null ? item.ozonSku.toString() : item.offerId;
      // unitPrice HER ZAMAN TEK ADEDİN fiyatı olmalı (item.price zaten birim fiyat — bkz.
      // computeOrderAmount'ta price × quantity ile toplam hesaplanması, yani price birim demek).
      // DOĞRULANDI (2026-09-15, ASE'nin kendi ekibiyle — Devrim Eriş — yapılan gerçek görüşme):
      // "ilk API bağlayanlar çoklu üründe yanlışlıkla TOPLAMI yolluyor" diye uyardılar, bizde bu
      // doğru. Aynı görüşmede AYRICA doğrulandı: aynı üründen birden fazla adet olsa bile
      // (item.quantity > 1) TEK bir satır yeterli — "2 adet diye de gelebiliyor, tek tek gelmez
      // genelde aynı ürün olunca" (ASE'nin kendi sözü) — adet bilgisini zaten Ozon'dan ayrıca
      // alıyorlar ("Bize de 1 satır gelir, Ozon'dan geliyor veri"), bizim tekrar tekrar aynı
      // satırı göndermemize gerek yok; asıl kritik olan unitPrice'ın yine de BİRİM fiyat olması.
      // (Önceki bir denemede bu net değildi, item.quantity kadar TEKRARLANAN satır gönderiliyordu
      // — ASE'nin doğrudan onayıyla bu GERİ ALINDI, tek satıra dönüldü.)
      const unitPrice = Number((Number(item.price) * fxRate).toFixed(2));

      shipmentProductList.push({
        articleCode,
        hsCode,
        unitPrice,
        productOriginCountryCode: PRODUCT_ORIGIN_COUNTRY_CODE,
      });
    }

    const payload: SendShipmentPayload = {
      code: postingNumber,
      shipmentType: ASE_SHIPMENT_TYPE, // ÇÖZÜLDÜ (2026-09-15) — bkz. src/ase/client.ts yorumu.
      invoiceDate: toAseInvoiceDateString(order.parasutInvoicedAt),
      invoiceNo: order.parasutInvoiceNo,
      invoiceCurrencyCode: INVOICE_CURRENCY_CODE,
      invoiceBase64String,
      invoiceUrl: "",
      invoiceFileExtension: INVOICE_FILE_EXTENSION,
      shipmentProductList,
    };

    const result = await sendShipment(payload);
    const message = result.message || describeAseCode(result.code);

    // DÜZELTME (2026-09-24'te canlıda, kullanıcı bulgusu: "hs kod sorması gerekmiyor muydu... bu
    // ürünlerin HS'sinde hiçbir sorun yok" — resmi ASE API dokümanıyla doğrulandı): kod 32,
    // HS/GTIP ile İLGİLİ DEĞİL — "Pazaryerinden(Ozon) ASE'ye iletilmemiş gönderi için işlem
    // yapılamaz" demek, yani Ozon bu kargoyu ASE'ye henüz kendi tarafından bildirmemiş (bkz.
    // src/ase/constants.ts SHIPMENT_NOT_YET_SYNCED_ERROR_CODE yorumu). Bu GERÇEK bir hata değil,
    // saf bir zamanlama meselesi — fatura onayımız hızlandığı için (bkz. eArchives.ts) artık
    // Ozon'un kendi ASE senkronundan daha erken davranabiliyoruz. Kalıcı "başarısız/✗" işaretlemek
    // yerine (PDF-hazır-değil durumuyla AYNI mantık) sessizce erteliyoruz — aseShipmentSentAt boş
    // kalır, runAseAutoSend bir sonraki turda kendiliğinden tekrar dener.
    if (!result.isSuccess && result.code === SHIPMENT_NOT_YET_SYNCED_ERROR_CODE) {
      console.log(`[ase] ${postingNumber}: Ozon bu kargoyu ASE'ye henüz iletmemiş (kod 32), gönderim ertelendi.`);
      return;
    }

    await recordResult(postingNumber, result.isSuccess, message, result.isSuccess ? null : result.code);
    if (!result.isSuccess) {
      console.error(`[ase] Gönderim başarısız (posting ${postingNumber}, code ${result.code}): ${message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    console.error(`[ase] Gönderim sırasında beklenmedik hata (posting ${postingNumber}):`, err);
    await recordResult(postingNumber, false, message);
  }
}
