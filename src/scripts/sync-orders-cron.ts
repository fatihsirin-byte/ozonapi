import cron from "node-cron";
import { syncFbsOrders } from "../modules/orders/orders.service";
import { syncTransactionsForDateRange } from "../modules/finance/finance.service";
import { startShopifyImportJob, getShopifyImportJobStatus } from "../shopify/importJob";
import { runScheduledStockSync } from "../shopify/stockSync";
import { pollAseShipmentStatuses } from "../ase/statusPolling";
import { syncReturns, syncRfbsReturns } from "../modules/returns/returns.service";
import { prisma } from "../db/prisma";
import { findActiveEArchive, getEArchivePdfUrl } from "../parasut/eArchives";
import { cacheInvoicePdfIfMissing } from "../parasut/pdfCache";
import { INVOICE_CLAIM_SENTINEL } from "../parasut/orderInvoice";
import { sendOrderToAse } from "../ase/orderShipment";
import { fetchAndCacheLabel } from "../ozon/labelCache";
import { recheckDisputedShipping } from "../modules/finance/shipping-dispute.service";

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
// öğrenemiyordu). Sıralı (paralel DEĞİL) ve aralarında kısa bir gecikmeyle işleniyor — 429 hız
// sınırına toplu çarpmayı önlemek için.
//
// GÜNCELLEME (2026-09-24'te canlıda, kullanıcı bulgusu: 10 fatura saatlerce "PDF hazır değil"
// diye onaysız kaldı, ama Paraşüt'ün kendi kaydına bakılınca hepsinde invoice_number ZATEN
// atanmıştı, sadece GİB durumu "reporting"ti): "onay" artık PDF'in tam indirilebilir olmasını
// DEĞİL, e-Arşiv'in invoice_number alanının dolmasını bekliyor — kullanıcı kararı: "bu status
// fatura oluştu anlamına geliyor, invoice_number gelmiş, burada beklememize gerek yok" (bkz.
// src/parasut/eArchives.ts ActiveEArchiveInfo yorumu). PDF'in kendisi hâlâ AYRI ve best-effort
// olarak önbelleğe alınmaya çalışılıyor (varsa) ama bu artık onayı GECİKTİRMİYOR — bu sayede ASE
// gönderimi (parasutInvoiceNoConfirmed'a bağlı, bkz. runAseAutoSend) GİB onayını beklemeden, GİB'e
// gönderim anında (invoice_number atanır atanmaz) tetiklenebiliyor.
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
      const archive = await findActiveEArchive(invoiceId);
      if (archive?.invoiceNumber) {
        await prisma.order.update({
          where: { postingNumber: order.postingNumber },
          data: { parasutInvoiceNo: archive.invoiceNumber, parasutInvoiceNoConfirmed: true },
        });
        confirmed += 1;
        // PDF'in kendisi hazırsa (genelde henüz değildir, GİB onayı ayrı/daha yavaş bir adım)
        // fırsat bu fırsattır diye önbelleğe alınıyor — başarısız olsa da onayı ETKİLEMEZ.
        try {
          const pdfUrl = await getEArchivePdfUrl(archive.id);
          if (pdfUrl) await cacheInvoicePdfIfMissing(order.postingNumber, pdfUrl);
        } catch {
          // sessizce atlanır — PDF ne zaman hazır olursa "Faturayı Aç" butonu zaten indirir.
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

// ACİL SINIRLAMA (2026-09-23'te canlıda, ilk deploy'dan dakikalar sonra tespit edildi): yukarıdaki
// sorgu filtresiz haliyle deploy edildiğinde, "fatura onaylı ama ASE hiç gönderilmemiş" 261 GEÇMİŞ
// siparişle karşılaşıldı — hepsi 2026-09-10/15 tarihli (8-13 gün önce faturalanmış), 2'si de
// "cancelled" (İPTAL EDİLMİŞ) durumda. Cron bunları hemen ilk turda 25'erli gruplar halinde
// göndermeye BAŞLAMIŞTI BİLE. Bu, planlanan davranış DEĞİL — bu iş SADECE "fatura az önce onaylandı
// ama kimse sayfayı açmadığı için ASE gönderilemedi" tazeliğindeki siparişler için tasarlanmıştı,
// günler önceki geçmiş bir birikimi geriye dönük toptan bildirmek için değil (geç/geriye dönük
// gümrük beyanı ASE tarafından reddedilebilir ya da başka bir sonuç doğurabilir — bu kullanıcının
// kararı, otomatik bir cron'un DEĞİL). Bu yüzden BURADA, karar verilene kadar: (a) sadece SON 24
// SAATTE faturalanmış siparişlerle sınırlandı, (b) "cancelled" durumundaki siparişler KESİN olarak
// hariç tutuldu (iptal edilmiş bir siparişe gümrük beyanı gitmesi asla doğru olmaz).
const ASE_AUTO_SEND_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// NOT (2026-09-23, kullanıcı doğruladı): bu sınır eklendiğinde 236 adet ESKİ (10-15 Eylül tarihli)
// sipariş "faturası onaylı ama ASE'ye hiç gönderilmemiş" halde bulunmuştu — bu bir HATA/BUG
// DEĞİL: "Fatura Kes" ve "ASE'ye Gönder" 16 Eylül'e kadar AYRI iki manuel butondu (bkz.
// InvoiceAndAseButton.tsx ve sendOrderToAse'in üstündeki tarihçe notu), bu siparişlerde ikinci adım
// elle atlanmış/unutulmuş. Kullanıcı kararı: bu geçmiş siparişler kasıtlı olarak GÖRMEZDEN
// GELİNİYOR, geriye dönük ASE gönderimi yapılmayacak — 24 saatlik sınır bunları zaten kapsam
// dışında tutuyor, burada AYRICA bir "temizlik" kodu YAZILMADI.

async function runAseAutoSend() {
  const pending = await prisma.order.findMany({
    where: {
      parasutInvoiceNoConfirmed: true,
      aseShipmentSentAt: null,
      parasutInvoicedAt: { gte: new Date(Date.now() - ASE_AUTO_SEND_MAX_AGE_MS) },
      NOT: { status: "cancelled" },
    },
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

// KRİTİK (2026-09-23, kullanıcı bulgusu: "etiket yazdır diyince 4-5 saniye bekliyor bence ozona
// gidip soruyor. db de tut ve backfill at"): doğru — /api/orders/[postingNumber]/label HER
// tıklamada Ozon'a canlı istek atıyordu. Artık önce diske bakıyor (bkz. src/ozon/labelCache.ts),
// burada da o önbelleği DOLDURAN arka plan işi var — sipariş "awaiting_deliver" (Kargoya Hazır)
// olur olmaz etiketi önceden çekip kaydediyor, kullanıcı butona basmadan ÖNCE hazır olsun diye.
// SADECE bu durumdaki siparişler taranıyor çünkü Ozon'un etiket API'si BAŞKA hiçbir durumda
// çalışmıyor (bkz. label/route.ts) — "henüz hazırlanıyor" hatası alırsa (posting paketlendikten
// hemen sonra, etiket Ozon tarafında henüz oluşmamışsa) burada sessizce loglanır, bir sonraki
// turda (5 dakika sonra) otomatik tekrar denenir.
const LABEL_BACKFILL_BATCH_SIZE = 25;
const LABEL_BACKFILL_DELAY_MS = 1000;

// Finans Mütabakatı (2026-09-28, kullanıcı talebi): "disputed" işaretlenmiş siparişlerin
// GÜNCEL gerçek kargo tutarını itiraz anındaki tutarla (baseline) karşılaştırır — Ozon
// düzelttiyse otomatik "resolved"a geçirir (bkz. shipping-dispute.service.ts
// recheckDisputedShipping). ASE gümrük durumu gibi bu da sadece OKUMA yapar, Ozon'a hiçbir
// bildirim/itiraz göndermez — o kullanıcının kendi elle yaptığı ayrı bir süreç. Kargo kesintisi
// ASE beyanı kadar sık değişmediği için AYNI 3 saatlik zamanlamada (runAsePoll) çalışıyor.
async function runShippingDisputeRecheck() {
  try {
    const { checked, resolved } = await recheckDisputedShipping();
    if (resolved > 0) {
      console.log(`[sync-orders-cron] ${new Date().toISOString()} — finans mütabakatı: ${checked} itiraz kontrol edildi, ${resolved} tanesi Ozon tarafından düzeltilmiş görünüyor`);
    }
  } catch (error) {
    console.error(`[sync-orders-cron] ${new Date().toISOString()} — finans mütabakatı kontrol hatası:`, error);
  }
}

async function runLabelBackfill() {
  const pending = await prisma.order.findMany({
    where: { status: "awaiting_deliver", shippingLabelCached: false },
    select: { postingNumber: true },
    take: LABEL_BACKFILL_BATCH_SIZE,
  });
  if (pending.length === 0) return;

  let cached = 0;
  for (const order of pending) {
    try {
      await fetchAndCacheLabel(order.postingNumber);
      cached += 1;
    } catch (error) {
      console.error(`[sync-orders-cron] Etiket önbelleğe alınamadı (posting ${order.postingNumber}):`, error);
    }
    await new Promise((resolve) => setTimeout(resolve, LABEL_BACKFILL_DELAY_MS));
  }
  console.log(`[sync-orders-cron] ${new Date().toISOString()} — ${cached}/${pending.length} sipariş etiketi arka planda önbelleğe alındı`);
}

// ACİL DÜZELTME (2026-09-24, kullanıcı bulgusu: bugün art arda kesilen 10 fatura, saatlerdir
// onaylanmıyordu): runInvoiceConfirmationSync + runAseAutoSend + runLabelBackfill hepsi AYNI
// "*/5 * * * *" zamanlamasında, yani TAM AYNI ANDA çalışıyordu — üçü birden Paraşüt'e (ve ASE'ye)
// eşzamanlı istek yağdırınca, kendi trafiğimiz kendi hız sınırımıza (429) çarpıyordu. Ana Paraşüt
// API erişimi ayrıca test edilip HIZLI/sağlıklı olduğu doğrulandı (genel bir Paraşüt kesintisi
// DEĞİL) — bu yüzden dakikaları birbirinden AYIRARAK (eşzamanlı yük yerine art arda, seyrek yük)
// kendi kendine çarpışmayı azaltıyoruz. Not: GİB'in kendi e-Arşiv onay süresi bizim kontrolümüzde
// değil — bu değişiklik SADECE bizim kendi isteklerimizin üst üste binmesini önlüyor.
// Shopify → ürün/stok senkronu (2026-10-09, kullanıcı kararı): mesai içinde (İstanbul saati
// 09:00-18:00) günde 4 kez — 09, 12, 15, 18. Önce yeni/stoklu ürünler içe aktarılır (hiçbir
// pazaryerine bağlı olmadan "draft" gelir) ve stok DB'ye yazılır; sonra stoğu biten ürünler
// Ozon/toptantr'da kapatılır. Mesai dışında çalışmaz.
async function runShopifySync() {
  try {
    const started = startShopifyImportJob();
    if (started.started) {
      // importJob kendi içinde 8-10 dk sürebiliyor; bitmesini bekle (Shopify hesap başına tek bulk
      // operation — stok senkronu onunla aynı anda çalışamaz).
      for (let i = 0; i < 180; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        if (getShopifyImportJobStatus().state !== "running") break;
      }
    }
    const status = getShopifyImportJobStatus();
    if (status.state === "error") console.error(`[sync-orders-cron] Shopify içe aktarma hatası: ${status.message}`);
    const { db, report } = await runScheduledStockSync();
    console.log(
      `[sync-orders-cron] ${new Date().toISOString()} — Shopify stok senkronu: ${db.updated} ürün stoğu DB'ye yazıldı; Ozon kapatılan ${report.ozon.closed} (hata ${report.ozon.errors.length}), toptantr kapatılan ${report.toptantr.closed} (hata ${report.toptantr.errors.length})`,
    );
  } catch (error) {
    console.error(`[sync-orders-cron] ${new Date().toISOString()} — Shopify senkronu hatası:`, error);
  }
}

cron.schedule("0 9,12,15,18 * * *", runShopifySync, { timezone: "Europe/Istanbul" });
cron.schedule("*/15 * * * *", runSync);
cron.schedule("*/15 * * * *", runReturnsSync);
cron.schedule("0 */3 * * *", runAsePoll);
cron.schedule("30 */3 * * *", runShippingDisputeRecheck);
cron.schedule("1,6,11,16,21,26,31,36,41,46,51,56 * * * *", runInvoiceConfirmationSync);
cron.schedule("3,8,13,18,23,28,33,38,43,48,53,58 * * * *", runAseAutoSend);
cron.schedule("*/5 * * * *", runLabelBackfill);
console.log(
  "[sync-orders-cron] başlatıldı — sipariş/finans/iade senkronu 15 dakikada bir, ASE durum kontrolü 3 saatte bir, bekleyen fatura onayı/ASE gönderimi/etiket önbellekleme 5 dakikada bir çalışacak",
);
runSync();
runReturnsSync();
runAsePoll();
runInvoiceConfirmationSync();
runAseAutoSend();
runLabelBackfill();
runShippingDisputeRecheck();
