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

// Aynı sipariş için üst üste gelen poll istekleri (bkz. çağıran route) eş zamanlı birden fazla
// gönderimi tetiklemesin diye basit bir in-flight kilit — sonuç DB'ye yazılana kadar aynı
// postingNumber için ikinci bir çağrı sessizce atlanır.
const inFlight = new Set<string>();

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

// Bir Ozon siparişini ASE'ye (gümrük/ETGB) bildirir. Fatura numarası KESİNLEŞMEDEN (bkz.
// Order.parasutInvoiceNoConfirmed) hiçbir şey yapmaz — henüz geçici olabilecek bir numarayı
// gümrüğe bildirmemek için (bkz. app/api/orders/[postingNumber]/parasut-invoice/pdf/route.ts).
// TASARIM GEREĞİ hiçbir zaman exception fırlatmaz — bu, ana fatura akışının bir eklentisi,
// başarısız olsa bile faturanın kesilmiş olmasını etkilememeli (2026-09-12, görev talimatı).
export async function sendOrderToAse(postingNumber: string): Promise<void> {
  if (inFlight.has(postingNumber)) return;
  inFlight.add(postingNumber);
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
      // Daha önce başarıyla gönderildi — çağıran taraf artık her "hazır" kontrolünde tekrar
      // deniyor (bkz. pdf/route.ts), bu yüzden burada tekrar göndermemek için ayrıca kontrol ediyoruz.
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
  } finally {
    inFlight.delete(postingNumber);
  }
}

// sendOrderToAse'in TEK tetikleyicisi olan parasut-invoice/pdf/route.ts, bir sipariş sayfası
// AÇIKKEN ve fatura numarası henüz "confirmed" DEĞİLKEN çağrılıyor (bkz. ParasutInvoiceButton.tsx
// retryable/initialConfirmed mantığı — zaten doğrulanmış faturalarda kasıtlı olarak hiç canlı
// kontrol yapılmıyor, 2026-09-10 tarihli ayrı bir performans düzeltmesi). Yani kimse o sipariş
// sayfasını tekrar açmazsa (ya da açtığında fatura zaten onaylanmışsa) ASE'ye gönderim BİR DAHA
// hiç denenmez — code review'da tespit edildi (2026-09-13). Bunun için, zaten 15 dakikada bir
// çalışan sipariş senkronizasyon cron'una (bkz. src/scripts/sync-orders-cron.ts) bir de bunu
// ekliyoruz: fatura numarası kesinleşmiş ama ASE'ye henüz başarıyla gönderilmemiş TÜM siparişleri
// bulup gönderir — kimse sayfayı açmasa bile güvenilir şekilde çalışır, pdf/route.ts'teki
// tetikleme ise sadece "mümkünse hemen gönder" için bir ek hızlandırma olarak kalır.
export async function dispatchPendingAseShipments(): Promise<void> {
  const pending = await prisma.order.findMany({
    where: { parasutInvoiceNoConfirmed: true, aseShipmentSuccess: { not: true } },
    select: { postingNumber: true },
  });
  for (const { postingNumber } of pending) {
    await sendOrderToAse(postingNumber);
    // ASE hız sınırı: istekler arası en az 300ms (bkz. ase api.pdf) — sendOrderToAse zaten en az
    // bir HTTP isteği içerdiğinden pratikte bu süre çoktan geçmiş oluyor, yine de garanti altına
    // almak için küçük bir bekleme ekleniyor.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}
