import cron from "node-cron";
import { syncFbsOrders } from "../modules/orders/orders.service";
import { syncTransactionsForDateRange } from "../modules/finance/finance.service";
import { backfillMissingStock } from "../modules/products/products.service";

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

cron.schedule("*/15 * * * *", runSync);
console.log("[sync-orders-cron] başlatıldı, her 15 dakikada bir çalışacak");
runSync();
