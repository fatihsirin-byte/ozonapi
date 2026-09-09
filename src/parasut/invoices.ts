import { parasutGet, parasutPost } from "./client";

// Paraşüt'ün JSON:API'si — "invoice": genel satış faturası, "export": ihracat faturası (KDV
// istisnası). Ozon üzerinden Türkiye'den Rusya'ya yapılan satışlar muhtemelen "export" olacak
// ama kesin kural (item_type, KDV oranı, e-fatura/e-arşiv zorunluluğu vb.) muhasebe tarafından
// (kullanıcı) teyit edilecek — bkz. sales_invoices modülündeki not.
export type ParasutInvoiceItemType = "invoice" | "export" | "cost" | "return" | "cancelled";

export interface ParasutSalesInvoiceDetailInput {
  quantity: number;
  unit_price: number;
  vat_rate: number;
  description: string;
  discount_type?: "percentage" | "amount";
  discount_value?: number;
}

export interface CreateSalesInvoiceInput {
  itemType?: ParasutInvoiceItemType;
  description?: string;
  issueDate: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  currency?: "TRL" | "USD" | "EUR"; // Paraşüt "TRL" kullanıyor, "TRY" değil
  exchangeRate?: number; // currency TRL değilse gerekli
  invoiceSeries?: string;
  invoiceId?: string;
  contactId: string;
  details: ParasutSalesInvoiceDetailInput[];
}

export interface ParasutSalesInvoice {
  id: string;
  type: "sales_invoices";
  attributes: Record<string, unknown>;
}

export interface ParasutSalesInvoiceResponse {
  data: ParasutSalesInvoice;
}

export interface ParasutSalesInvoiceListResponse {
  data: ParasutSalesInvoice[];
  meta?: { total_count?: number };
}

// JSON:API "details" ilişkisi, her satırı "sales_invoice_details" tipinde ayrı bir kaynak olarak
// gönderiyor (bkz. Paraşüt API v4 dokümantasyonu örnekleri).
export function createSalesInvoice(input: CreateSalesInvoiceInput) {
  return parasutPost<ParasutSalesInvoiceResponse>("sales_invoices?include=active_e_document", {
    data: {
      type: "sales_invoices",
      attributes: {
        item_type: input.itemType ?? "invoice",
        description: input.description,
        issue_date: input.issueDate,
        due_date: input.dueDate ?? input.issueDate,
        currency: input.currency ?? "TRL",
        exchange_rate: input.exchangeRate,
        invoice_series: input.invoiceSeries,
        invoice_id: input.invoiceId,
      },
      relationships: {
        contact: {
          data: { id: input.contactId, type: "contacts" },
        },
        details: {
          data: input.details.map((d) => ({
            type: "sales_invoice_details",
            attributes: {
              quantity: d.quantity,
              unit_price: d.unit_price,
              vat_rate: d.vat_rate,
              description: d.description,
              discount_type: d.discount_type,
              discount_value: d.discount_value,
            },
          })),
        },
      },
    },
  });
}

export function listSalesInvoices(page = 1, size = 25) {
  return parasutGet<ParasutSalesInvoiceListResponse>(`sales_invoices?page[number]=${page}&page[size]=${size}`);
}

export function showSalesInvoice(invoiceId: string) {
  return parasutGet<ParasutSalesInvoiceResponse>(`sales_invoices/${invoiceId}?include=active_e_document,contact,details.product`);
}
