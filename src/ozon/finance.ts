import { ozonPost } from "./client";

export interface OzonFinanceTransactionItem {
  operation_id: number;
  operation_type: string;
  operation_date: string;
  posting: { posting_number: string; delivery_schema: string };
  amount: number;
  accruals_for_sale: number;
  sale_commission: number;
  delivery_charge: number;
  return_delivery_charge: number;
  items: Array<{ name: string; sku: number }>;
}

export interface OzonFinanceTransactionListResponse {
  result: {
    operations: OzonFinanceTransactionItem[];
    page_count: number;
    row_count: number;
  };
}

// posting_number verilirse tek sipariş bazında komisyon+kargo+diğer kesintiler dönüyor.
export function listTransactions(params: {
  postingNumber?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}) {
  return ozonPost<OzonFinanceTransactionListResponse>("/v3/finance/transaction/list", {
    filter: {
      date: params.dateFrom && params.dateTo ? { from: params.dateFrom, to: params.dateTo } : undefined,
      posting_number: params.postingNumber ?? "",
      transaction_type: "all",
    },
    page: params.page ?? 1,
    page_size: params.pageSize ?? 1000,
  });
}

export interface OzonFinanceTotalsResponse {
  result: {
    accruals_for_sale: number;
    sale_commission: number;
    processing_and_delivery: number;
    refunds_and_cancellations: number;
    services_amount: number;
    others_amount: number;
  };
}

export function getTransactionTotals(params: { postingNumber?: string; dateFrom: string; dateTo: string }) {
  return ozonPost<OzonFinanceTotalsResponse>("/v3/finance/transaction/totals", {
    date: { from: params.dateFrom, to: params.dateTo },
    posting_number: params.postingNumber ?? "",
    transaction_type: "all",
  });
}
