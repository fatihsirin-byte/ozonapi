import { ozonPost } from "./client";

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
  result: { posting_number: string[] };
}

// Siparişi paketleyip kargoya hazır hale getirir (exemplar/kutu bilgisi Ozon kategorisine göre değişebilir).
export function shipFbsPosting(params: {
  postingNumber: string;
  packages: Array<{ products: Array<{ product_id: number; quantity: number }> }>;
}) {
  return ozonPost<OzonFbsShipResponse>("/v2/posting/fbs/ship", {
    posting_number: params.postingNumber,
    packages: params.packages,
  });
}

export function cancelFbsPosting(params: { postingNumber: string; cancelReasonId: number; cancelReasonMessage?: string }) {
  return ozonPost("/v2/posting/fbs/cancel", {
    posting_number: params.postingNumber,
    cancel_reason_id: params.cancelReasonId,
    cancel_reason_message: params.cancelReasonMessage,
  });
}
