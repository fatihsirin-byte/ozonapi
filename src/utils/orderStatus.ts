// Ozon'un FBS posting durumlarını Türkçeye çevirir (2026-09-10, kullanıcı talebi). Eşleşmeyen bir
// durum gelirse (Ozon'un dokümante etmediği ama API'de görülebilen ara durumlar için) ham değer
// aynen gösterilir — kullanıcı hiçbir zaman boş bir etiketle karşılaşmasın diye.
const ORDER_STATUS_LABELS_TR: Record<string, string> = {
  awaiting_packaging: "Paketleme Bekliyor",
  awaiting_deliver: "Kargoya Hazır",
  awaiting_registration: "Kayıt Bekliyor",
  acceptance_in_progress: "Kabul Sürüyor",
  arbitration: "İhtilaf",
  client_arbitration: "Müşteri İhtilafı",
  delivering: "Kargoda",
  driver_pickup: "Kurye Bekliyor",
  not_accepted: "Kabul Edilmedi",
  delivered: "Teslim Edildi",
  cancelled: "İptal Edildi",
  sent_by_seller: "Satıcı Tarafından Gönderildi",
};

export function translateOrderStatus(status: string): string {
  return ORDER_STATUS_LABELS_TR[status] ?? status;
}
