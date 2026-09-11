import { ozonPost, ozonPostBinary } from "./client";

export interface OzonFbsPosting {
  posting_number: string;
  status: string;
  order_date: string;
  in_process_at: string;
  products: Array<{ offer_id: string; sku: number; quantity: number; price: string; name: string }>;
}

export interface OzonFbsListResponse {
  result: {
    postings: OzonFbsPosting[];
    has_next: boolean;
  };
}

// since/to ISO tarih, status opsiyonel filtre (awaiting_packaging, awaiting_deliver, delivering, delivered, cancelled, ...)
export function listFbsPostings(params: {
  since: string;
  to: string;
  status?: string;
  offset?: number;
  limit?: number;
}) {
  return ozonPost<OzonFbsListResponse>("/v3/posting/fbs/list", {
    filter: {
      since: params.since,
      to: params.to,
      status: params.status,
    },
    offset: params.offset ?? 0,
    limit: params.limit ?? 100,
    with: { analytics_data: true, financial_data: true },
  });
}

export interface OzonFbsGetResponse {
  result: OzonFbsPosting & Record<string, unknown>;
}

export function getFbsPosting(postingNumber: string) {
  return ozonPost<OzonFbsGetResponse>("/v2/posting/fbs/get", {
    posting_number: postingNumber,
    with: { analytics_data: true, financial_data: true },
  });
}

export interface OzonFbsShipResponse {
  // Sipariş bölünmeden (tek kutu) paketlenirse tek elemanlı, bölünürse birden fazla posting
  // numarası döner — bölünmüş her posting kendi ayrı gönderisi olur (2026-09-10'da resmi
  // dokümantasyon araştırmasıyla doğrulandı, bkz. BEKLEYEN-GELISTIRMELER.md #3).
  result: string[];
}

// Siparişi paketleyip kargoya hazır hale getirir — Ozon panelindeki "Topla" ile aynı adım, siparişi
// 1. durumdan (awaiting_packaging) 2. duruma geçirir ve kargo etiketinin oluşmasını TETİKLER
// (etiket bu çağrıdan ÖNCE üretilmiyor, bkz. BEKLEYEN-GELISTIRMELER.md #3, kullanıcı notu). Sipariş
// birden fazla kutuya bölünecekse `packages` dizisine BİRDEN FAZLA eleman gönderilir — Ozon'un
// resmi dokümantasyonu bunu tam bu şekilde tarif ediyor (2026-09-11'de doğrulandı, bkz.
// orders.service.ts distributeIntoPackages). NOT: `/v3/posting/multiboxqty/set` diye AYRI bir uç
// nokta da var ama o BAMBAŞKA bir senaryo için (rFBS Aggregator şeması + Ozon'un TEK bir ürünü
// "çok kutulu" olarak işaretlediği durum) — standart FBS siparişinde bölme için KULLANILMAMALI,
// denendi ve "POSTING_DOES_NOT_HAVE_MULTI_BOX_PRODUCT" hatasıyla reddedildi.
export function shipFbsPosting(params: {
  postingNumber: string;
  packages: Array<{ products: Array<{ product_id: number; quantity: number }> }>;
}) {
  return ozonPost<OzonFbsShipResponse>(
    "/v4/posting/fbs/ship",
    { posting_number: params.postingNumber, packages: params.packages },
    { retry: false },
  );
}

// shipFbsPosting gibi GERÇEK, geri alınamaz bir yazma isteği — otomatik retry burada da kapalı
// (2026-09-10'da code review'da tespit edildi: henüz hiçbir yerden çağrılmıyor ama ileride
// bağlanırsa aynı çift-işlem riskini taşıyordu).
export function cancelFbsPosting(params: { postingNumber: string; cancelReasonId: number; cancelReasonMessage?: string }) {
  return ozonPost(
    "/v2/posting/fbs/cancel",
    {
      posting_number: params.postingNumber,
      cancel_reason_id: params.cancelReasonId,
      cancel_reason_message: params.cancelReasonMessage,
    },
    { retry: false },
  );
}

// Kargo etiketi (barkodlu PDF) — Ozon bazen "henüz hazırlanıyor" hatası dönebiliyor (etiket
// posting paketlendikten kısa süre sonra oluşuyor), bu durumda ozonPostBinary hata fırlatır.
export function getFbsPackageLabel(postingNumber: string): Promise<Buffer> {
  return ozonPostBinary("/v2/posting/fbs/package-label", {
    posting_number: [postingNumber],
  });
}
