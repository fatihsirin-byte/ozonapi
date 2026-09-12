import { prisma } from "../db/prisma";
import { getOrderDetail, suggestHsCodesForOrder } from "../modules/orders/orders.service";
import { readCachedInvoicePdf } from "../parasut/pdfCache";
import { sendShipment, ASE_SHIPMENT_TYPE, describeAseCode, type AseShipmentProduct, type SendShipmentPayload } from "./client";

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

async function recordResult(postingNumber: string, success: boolean, message: string) {
  try {
    await prisma.order.update({
      where: { postingNumber },
      data: { aseShipmentSentAt: new Date(), aseShipmentSuccess: success, aseShipmentMessage: message },
    });
  } catch (err) {
    console.error(`[ase] Sonuç Order'a kaydedilemedi (posting ${postingNumber}):`, err);
  }
}

// Bir Ozon siparişini ASE'ye (gümrük/ETGB) bildirir. SADECE ELLE, kullanıcı sipariş sayfasındaki
// "ASE'ye Gönder" butonuna bastığında çağrılır (bkz. app/api/orders/[postingNumber]/ase-shipment/route.ts)
// — önceki bir sürümde hem fatura PDF durumu kontrol edilirken hem 15 dakikalık cron'da otomatik
// deneniyordu, kullanıcı bunu öngörülemez bulup kaldırılmasını istedi (2026-09-13). Fatura numarası
// KESİNLEŞMEDEN (bkz. Order.parasutInvoiceNoConfirmed) hiçbir şey yapmaz — henüz geçici olabilecek
// bir numarayı gümrüğe bildirmemek için. TASARIM GEREĞİ hiçbir zaman exception fırlatmaz — çağıran
// route sonucu (isSuccess/mesaj) DB'den okuyup kullanıcıya gösterir.
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
    // src/parasut/pdfCache.ts cacheInvoicePdfIfMissing — bu fonksiyon çağrılmadan HEMEN önce,
    // aynı route'ta çalışıyor). Görev talimatındaki "parasutPrintUrl'den indir" yaklaşımı yerine
    // BİLEREK bu önbelleği kullanıyoruz: parasutPrintUrl aslında Paraşüt'ün giriş gerektiren
    // /print sayfası (oturum çerezi olmadan sunucu tarafından indirilemez), oysa pdfCache.ts
    // zaten doğrulanmış, çalışan bir PDF kaynağı sağlıyor.
    const pdfBuffer = await readCachedInvoicePdf(postingNumber);
    if (!pdfBuffer) {
      await recordResult(postingNumber, false, "Fatura PDF'i önbellekte bulunamadı");
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
        await recordResult(postingNumber, false, `GTİP kodu bulunamadı: ${item.offerId}`);
        return;
      }

      // TODO (ilk canlı testte doğrulanmalı): doküman "articleCode Ozon'dan bize gelen kodla aynı
      // olmalı" diyor — Ozon'un kendi hs_codes gönderimlerinde offerId değil ozonSku (numerik)
      // kullanılıyor (bkz. OrderItem.ozonSku açıklaması, orders.service.ts), o yüzden burada da
      // ozonSku kullanıldı. ozonSku her zaman dolu olmayabilir (eski/senkronize edilmemiş
      // kalemlerde) — o durumda offerId'ye düşülüyor, ama ASE'nin bunu kabul edip etmeyeceği
      // doğrulanmadı.
      const articleCode = item.ozonSku != null ? item.ozonSku.toString() : item.offerId;
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
      // TODO (doküman kendi içinde çelişkili, ÇÖZÜLMEDİ — bkz. src/ase/client.ts ASE_SHIPMENT_TYPE
      // yorumu): element tablosu/hata kod 35 sadece "Courier"/"Micro" diyor, örnek istekte "Etgb"
      // kullanılmış. Gerçek ilk canlı testte doğrulanacak, tek yerden (ASE_SHIPMENT_TYPE) değişebilir.
      shipmentType: ASE_SHIPMENT_TYPE,
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
    await recordResult(postingNumber, result.isSuccess, message);
    if (!result.isSuccess) {
      console.error(`[ase] Gönderim başarısız (posting ${postingNumber}, code ${result.code}): ${message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    console.error(`[ase] Gönderim sırasında beklenmedik hata (posting ${postingNumber}):`, err);
    await recordResult(postingNumber, false, message);
  }
}
