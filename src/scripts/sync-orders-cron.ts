import cron from "node-cron";
import { syncFbsOrders } from "../modules/orders/orders.service";
import { syncTransactionsForDateRange } from "../modules/finance/finance.service";
import { backfillMissingStock } from "../modules/products/products.service";
import { pollAseShipmentStatuses } from "../ase/statusPolling";
import { syncReturns, syncRfbsReturns } from "../modules/returns/returns.service";
import { prisma } from "../db/prisma";
import { resolveInvoicePdfForOrder } from "../parasut/eArchives";
import { showSalesInvoice } from "../parasut/invoices";
import { cacheInvoicePdfIfMissing } from "../parasut/pdfCache";
import { INVOICE_CLAIM_SENTINEL } from "../parasut/orderInvoice";
import { sendOrderToAse } from "../ase/orderShipment";

const DEFAULT_STOCK = 100;

// PM2 altında ayrı bir process olarak sürekli çalışır (bkz. ecosystem.config.cjs "ozon-sync-cron"),
// her 15 dakikada bir son 30 günün sipariş + finans verisini çeker. NOT: since/to, Ozon'un
// filter'ında siparişin YERLEŞTİRİLME (order_date) tarihine göre çalışıyor — sipariş DURUMU
// (kargoya verildi/teslim edildi/iptal) günler sonra değişebiliyor, o yüzden pencere dar
// tutulursa (önceden 2 gündü) eski bir siparişin durum güncellemesi otomatik yakalanamıyor,
// sadece elle "Senkronize Et" (30 gün) ile görünüyordu — 2026-08-14'te kullanıcı bunu fark
// etti, pencere elle senkronizasyonla aynı 30 güne çıkarıldı.
async function runSync() {
  const to = new Date().toISOString();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const orders = await syncFbsOrders({ since, to });
    const txCount = await syncTransactionsForDateRange(since, to);
    console.log(`[sync-orders-cron] ${new Date().toISOString()} — ${orders.length} sipariş, ${txCount} finans işlemi senkronize edildi`);
  } catch (error) {
    console.error(`[sync-orders-cron] ${new Date().toISOString()} — hata:`, error);
  }

  try {
    const { total, updated } = await backfillMissingStock(DEFAULT_STOCK);
    if (total > 0) {
      console.log(`[sync-orders-cron] ${new Date().toISOString()} — stok eksik ${total} ürün bulundu, ${updated} tanesi düzeltildi`);
    }
  } catch (error) {
    console.error(`[sync-orders-cron] ${new Date().toISOString()} — stok backfill hatası:`, error);
  }
}

// ASE gümrük beyanı/iptal/ölçüm durumu — SADECE OKUMA yapan bir sorgu, ASE'ye hiçbir gerçek
// bildirim göndermez (bkz. statusPolling.ts), o yüzden sendOrderToAse'in aksine (bkz. o
// dosyadaki "SADECE ELLE" notu) burada otomatik/periyodik çalışması güvenlidir. BİLEREK yukarıdaki
// 15 dakikalık runSync'in İÇİNDE değil, AYRI bir 3 saatlik zamanlamada — kullanıcı talebi
// (2026-09-16): "3 saatte 1 çalıştırabilirsin" (beyanname/iptal durumu Ozon sipariş senkronu kadar
// sık değişmiyor, 15 dakikada bir sorgulamaya gerek yok).
async function runAsePoll() {
  try {
    await pollAseShipmentStatuses();
  } catch (error) {
    console.error(`[sync-orders-cron] ${new Date().toISOString()} — ASE durum sorgusu hatası:`, error);
  }
}

// İade/iptal sayfası (2026-09-18, kullanıcı talebi) — durum değişiklikleri gün içinde olabiliyor,
// bu yüzden dar bir pencere (son 7 gün) her 15 dakikada bir tazeleniyor. İlk kurulumda geçmişe
// dönük 90 günlük veri "Senkronize Et" butonuyla (bkz. app/api/returns/sync/route.ts) elle
// çekiliyor — burada BİLEREK geniş pencere kullanılmıyor, her turda 90 günü baştan taramak
// gereksiz Ozon isteği anlamına gelirdi.
async function runReturnsSync() {
  try {
    const to = new Date();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const count = await syncReturns({ since, to });
    const rfbsCount = await syncRfbsReturns();
    console.log(`[sync-orders-cron] ${new Date().toISOString()} — ${count} iade kaydı, ${rfbsCount} rFBS iade/imha kaydı senkronize edildi`);
  } catch (error) {
    console.error(`[sync-orders-cron] ${new Date().toISOString()} — iade senkronu hatası:`, error);
  }
}

// KRİTİK (2026-09-23'te canlıda tespit edildi, kullanıcı bulgusu: "bugün faturası kesilenler"
// listesinde birkaç sipariş gri/onaysız takılı kaldı): fatura kesildikten sonraki e-Arşiv/GİB
// onayı ŞİMDİYE KADAR SADECE o siparişin satırı bir tarayıcıda açıkken çalışan istemci-taraflı
// polling'le (InvoiceAndAseButton.tsx, en fazla 2 dakika/12 deneme) tetikleniyordu — sayfa
// kapatılır/başka yere gidilirse ya da tam o an Paraşüt'ün 429 hız sınırına denk gelinirse (bkz.
// src/parasut/client.ts), onay bir daha KİMSE o siparişi elle "Tekrar Dene"lemeden asla
// gerçekleşmiyordu (fatura Paraşüt'te GERÇEKTEN var, sadece bizim DB'miz numarayı hiç
// öğrenemiyordu). Burada AYNI, güvenli resolveInvoicePdfForOrder'ı (yeni bir e-Arşiv OLUŞTURMUYOR,
// sadece var olanın durumunu soruyor — bkz. src/parasut/eArchives.ts) periyodik olarak sunucudan
// tekrar deniyoruz, kimse sayfayı açık tutmak zorunda kalmasın diye. Sıralı (paralel DEĞİL) ve
// aralarında kısa bir gecikmeyle işleniyor — 429 hız sınırına toplu çarpmayı önlemek için.
const INVOICE_CONFIRM_BATCH_SIZE = 25;
const INVOICE_CONFIRM_DELAY_MS = 1500;

async function runInvoiceConfirmationSync() {
  const pending = await prisma.order.findMany({
    where: {
      parasutInvoiceId: { not: null },
      parasutInvoiceNoConfirmed: false,
      NOT: { parasutInvoiceId: INVOICE_CLAIM_SENTINEL },
    },
    select: { postingNumber: true, parasutInvoiceId: true },
    take: INVOICE_CONFIRM_BATCH_SIZE,
  });
  if (pending.length === 0) return;

  let confirmed = 0;
  for (const order of pending) {
    const invoiceId = order.parasutInvoiceId as string;
    try {
      const result = await resolveInvoicePdfForOrder(order.postingNumber, invoiceId);
      if (result.status === "ready") {
        try {
          await cacheInvoicePdfIfMissing(order.postingNumber, result.pdfUrl);
        } catch (err) {
          console.error(`[sync-orders-cron] PDF önbelleğe alınamadı (posting ${order.postingNumber}):`, err);
        }
        const invoice = await showSalesInvoice(invoiceId);
        const invoiceNo = (invoice.data.attributes as { invoice_no?: string }).invoice_no ?? null;
        if (invoiceNo) {
          await prisma.order.update({
            where: { postingNumber: order.postingNumber },
            data: { parasutInvoiceNo: invoiceNo, parasutInvoiceNoConfirmed: true },
          });
          confirmed += 1;
        }
      }
    } catch (error) {
      console.error(`[sync-orders-cron] fatura onay kontrolü hatası (posting ${order.postingNumber}):`, error);
    }
    await new Promise((resolve) => setTimeout(resolve, INVOICE_CONFIRM_DELAY_MS));
  }
  if (confirmed > 0) {
    console.log(`[sync-orders-cron] ${new Date().toISOString()} — ${confirmed}/${pending.length} bekleyen fatura onayı arka planda tamamlandı`);
  }
}

// GÜNCELLEME (2026-09-23'te canlıda, kullanıcı bulgusu: "f5 attım paraşüt geldi, asey sonra yaptı
// demek ki tam arkaplanda çalışmıyor bu flow"): yukarıdaki runInvoiceConfirmationSync fatura
// numarasını arka planda onaylıyordu AMA ASE'ye gönderim hâlâ SADECE InvoiceAndAseButton.tsx
// bileşeni bir tarayıcıda mount olduğunda (sayfa açılınca) tetikleniyordu — kimse o siparişin
// sayfasını açmazsa, fatura onaylansa bile ASE'ye HİÇBİR ZAMAN gönderilmiyordu.
//
// NOT: sendOrderToAse'in üstündeki eski yorum ("SADECE ELLE ... kullanıcı bunu öngörülemez
// bulmuştu, 2026-09-13") o zamanki AYRI "ASE'ye Gönder" butonu modeli içindi. 2026-09-16'da akış
// "Fatura Kes + ASE'ye Gönder" olarak TEK bir otomatik zincire birleştirildi (bkz.
// InvoiceAndAseButton.tsx dosya başı yorumu) — yani kullanıcı zaten "fatura onaylanınca ASE
// otomatik gitsin" davranışını istiyor, sadece bunun bir tarayıcı sekmesi açık kalmasına bağlı
// olmaması gerekiyordu (2026-09-23, kullanıcı onayı: "evet, hemen ekle").
//
// sendOrderToAse KENDİ İÇİNDE güvenli: aynı sipariş için eşzamanlı çağrıları birleştiriyor
// (inFlight Map) ve aseShipmentSuccess zaten true ise hiçbir şey yapmıyor (bkz.
// src/ase/orderShipment.ts) — bu yüzden burada tekrar tekrar çağrılması ZARARSIZ. BİLEREK SADECE
// hiç denenmemiş (aseShipmentSentAt boş) siparişler için çalışıyor — daha önce GERÇEKTEN
// başarısız olmuş (ör. kalıcı HS kod hatası) siparişleri burada otomatik tekrar DENEMİYORUZ, o
// hâlâ kullanıcının "Tekrar Dene" butonuna basmasını gerektiriyor (aksi halde aynı bozuk siparişe
// 5 dakikada bir gereksiz ASE isteği atılırdı).
const ASE_AUTO_SEND_BATCH_SIZE = 25;
const ASE_AUTO_SEND_DELAY_MS = 1500;

async function runAseAutoSend() {
  const pending = await prisma.order.findMany({
    where: { parasutInvoiceNoConfirmed: true, aseShipmentSentAt: null },
    select: { postingNumber: true },
    take: ASE_AUTO_SEND_BATCH_SIZE,
  });
  if (pending.length === 0) return;

  let sent = 0;
  for (const order of pending) {
    try {
      await sendOrderToAse(order.postingNumber);
      sent += 1;
    } catch (error) {
      console.error(`[sync-orders-cron] ASE otomatik gönderim hatası (posting ${order.postingNumber}):`, error);
    }
    await new Promise((resolve) => setTimeout(resolve, ASE_AUTO_SEND_DELAY_MS));
  }
  console.log(`[sync-orders-cron] ${new Date().toISOString()} — ${sent}/${pending.length} sipariş arka planda ASE'ye gönderildi`);
}

cron.schedule("*/15 * * * *", runSync);
cron.schedule("*/15 * * * *", runReturnsSync);
cron.schedule("0 */3 * * *", runAsePoll);
cron.schedule("*/5 * * * *", runInvoiceConfirmationSync);
cron.schedule("*/5 * * * *", runAseAutoSend);
console.log(
  "[sync-orders-cron] başlatıldı — sipariş/finans/iade senkronu 15 dakikada bir, ASE durum kontrolü 3 saatte bir, bekleyen fatura onayı ve ASE gönderimi 5 dakikada bir çalışacak",
);
runSync();
runReturnsSync();
runAsePoll();
runInvoiceConfirmationSync();
runAseAutoSend();
