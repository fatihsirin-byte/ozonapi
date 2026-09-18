import { ozonPost } from "./client";

// Kullanıcı bulgusu (2026-09-18): bu hesap Ozon'un "realFBS" şemasını kullanıyor — iade/iptal
// verisi /v1/returns/list'te DEĞİL, bu tamamen ayrı uç noktada duruyor. İlk sürümde yanlış uç
// nokta kullanıldığı için (/v1/returns/list) panelde "0 iade" görünüyordu — Ozon'un kendi rFBS
// iade raporunda (kullanıcının indirdiği .xlsx) gerçek kayıtlar olduğu görülünce düzeltildi.
export interface OzonRfbsReturnItem {
  return_id: number;
  return_number?: string;
  order_number?: string;
  posting_number: string;
  created_at: string;
  product?: {
    sku?: number;
    offer_id?: string;
    name?: string;
    price?: number;
    currency_code?: string;
  };
  state?: {
    state?: string; // ör. "Utilizing"
    state_name?: string; // ör. "На утилизации" — Ozon panelin gösterdiği dille aynı aile
    group_state?: string; // "utilization" | "approved" | ...
    money_return_state_name?: string;
  };
}

export interface OzonRfbsReturnsListResponse {
  returns: OzonRfbsReturnItem[];
}

// Ozon'un last_id ile sayfaladığı, group_state/created_at filtrelenebilen rFBS iade listesi.
export function listRfbsReturns(params: { lastId?: number; limit?: number }) {
  return ozonPost<OzonRfbsReturnsListResponse>("/v2/returns/rfbs/list", {
    last_id: params.lastId ?? 0,
    limit: params.limit ?? 500,
  });
}
