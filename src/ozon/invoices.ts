import { ozonPost } from "./client";

// TR→RU cross-border satıcılar için Ozon'un KDV iadesi/gümrük amaçlı "proforma fatura" akışı.
// Önce dosya yükleniyor (base64), dönen url ile fatura kaydı oluşturuluyor/güncelleniyor.
// Kaynak: Ozon Seller API dokümantasyonu (docs.ozon.ru/api/seller) — "Invoices" bölümü.

export interface OzonUploadInvoiceFileResponse {
  url: string;
}

export function uploadInvoiceFile(params: { postingNumber: string; base64Content: string }) {
  return ozonPost<OzonUploadInvoiceFileResponse>("/v1/invoice/file/upload", {
    posting_number: params.postingNumber,
    base64_content: params.base64Content,
  });
}

export interface OzonHsCode {
  code: string;
  sku: string;
}

export interface CreateOrUpdateInvoiceParams {
  postingNumber: string;
  url: string;
  hsCodes: OzonHsCode[];
  date: string; // ISO 8601
  number: string;
  price: number;
  priceCurrency: string; // "USD" | "RUB" ...
}

export function createOrUpdateInvoice(params: CreateOrUpdateInvoiceParams) {
  return ozonPost<{ result: boolean }>("/v2/invoice/create-or-update", {
    posting_number: params.postingNumber,
    url: params.url,
    hs_codes: params.hsCodes.map((h) => ({ code: h.code, sku: h.sku })),
    date: params.date,
    number: params.number,
    price: params.price,
    price_currency: params.priceCurrency,
  });
}

export interface OzonInvoiceResult {
  date: string;
  file_url: string;
  hs_codes: OzonHsCode[];
  number: string;
  price: number;
  price_currency: string;
}

export function getInvoice(postingNumber: string) {
  return ozonPost<{ result: OzonInvoiceResult }>("/v2/invoice/get", { posting_number: postingNumber });
}

export function deleteInvoice(postingNumber: string) {
  return ozonPost<{ result: boolean }>("/v1/invoice/delete", { posting_number: postingNumber });
}
