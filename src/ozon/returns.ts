import { ozonPost } from "./client";

export interface OzonReturnItem {
  id: string;
  order_id?: string;
  order_number?: string;
  posting_number: string;
  type?: string; // "FullReturn" vb.
  schema?: string; // "Fbs" | "Fbo"
  return_reason_name?: string;
  product?: {
    sku?: string;
    offer_id?: string;
    name?: string;
    quantity?: number;
    price?: { price?: string; currency_code?: string };
  };
  storage?: {
    sum?: { price?: string; currency_code?: string };
    utilization_sum?: { price?: string; currency_code?: string };
  };
  logistic?: {
    cancelled_with_compensation_moment?: string | null;
  };
  visual?: {
    status?: { id?: number; display_name?: string; sys_name?: string };
    change_moment?: string;
  };
}

export interface OzonReturnsListResponse {
  returns: OzonReturnItem[];
  has_next: boolean;
}

// Ozon'un tek seferde en fazla 500 kayıt döndürdüğü, last_id ile sayfalanan iade listesi uç
// noktası. Sadece TEK bir filtre kabul ediyor (aksi halde hata veriyor) — burada
// visual_status_change_moment kullanılıyor (panelde görünen durumun değiştiği an), çünkü
// kullanıcının asıl ihtiyacı "şu aralıkta durumu değişen iadeler" — logistic_return_date ya da
// storage_tariffication_start_date her iade için dolu olmayabiliyor.
export function listReturns(params: { timeFrom: string; timeTo: string; lastId?: number; limit?: number }) {
  return ozonPost<OzonReturnsListResponse>("/v1/returns/list", {
    filter: {
      visual_status_change_moment: { time_from: params.timeFrom, time_to: params.timeTo },
    },
    limit: params.limit ?? 500,
    last_id: params.lastId ?? 0,
  });
}
