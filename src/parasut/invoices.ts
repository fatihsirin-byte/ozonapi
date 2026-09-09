import { parasutGet, parasutPost, parasutDelete, parasutGetBinary } from "./client";

// Paraşüt'ün JSON:API'si — Ozon üzerinden Rusya'ya yapılan satışlar için kullanıcının elle
// kestiği 466 gerçek faturadan (2026-09-09'da incelendi) çıkan patern: item_type "invoice"
// (export DEĞİL), currency TRL, satır KDV oranı %0 (301 mal ihracatı istisnası muhtemelen
// yazdırma şablonunda uygulanıyor, API alanında görünmüyor) — bkz. orderInvoice.ts.
export type ParasutInvoiceItemType = "invoice" | "export" | "cost" | "return" | "cancelled";

export interface ParasutSalesInvoiceDetailInput {
  quantity: number;
  unit_price: number;
  vat_rate: number;
  description: string;
  discount_type?: "percentage" | "amount";
  discount_value?: number;
  // Paraşüt her fatura satırı için bir "Ürün/Hizmet" kaydı istiyor — boş bırakılırsa "Ürün/hizmet
  // doldurulmalı" hatası veriyor (2026-09-09'da canlıda doğrulandı). bkz. src/parasut/products.ts.
  productId: string;
  // KDV istisna kodu — "301" (KDVK Md. 11/1-a, mal ihracatı istisnası). Kullanıcı talebi
  // (2026-09-09): "0 301 istisnası seçiyor musun mal ihracatı olarak" — vat_rate zaten 0 ama bu
  // alan olmadan resmi istisna kodu faturaya işlenmiyordu.
  vatExemptionCode?: string;
}

export interface CreateSalesInvoiceInput {
  itemType?: ParasutInvoiceItemType;
  description?: string;
  // Paraşüt'ün bastığı PDF'te "Fatura Açıklaması" olarak görünen serbest metin alanı — gerçek
  // faturalarda "301 - 11/1-a Mal İhracatı ETGB {gümrük no}" formatında (2026-09-09'da kullanıcının
  // paylaştığı gerçek fatura örneğinden alındı, bkz. orderInvoice.ts).
  invoiceNote?: string;
  issueDate: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  currency?: "TRL" | "USD" | "EUR"; // Paraşüt "TRL" kullanıyor, "TRY" değil
  exchangeRate?: number; // currency TRL değilse gerekli
  invoiceSeries?: string;
  invoiceId?: string;
  cashSale?: boolean;
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
        invoice_note: input.invoiceNote,
        issue_date: input.issueDate,
        due_date: input.dueDate ?? input.issueDate,
        currency: input.currency ?? "TRL",
        exchange_rate: input.exchangeRate,
        invoice_series: input.invoiceSeries,
        invoice_id: input.invoiceId,
        cash_sale: input.cashSale,
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
              vat_exemption_code: d.vatExemptionCode,
              description: d.description,
              discount_type: d.discount_type,
              discount_value: d.discount_value,
            },
            relationships: {
              product: { data: { id: d.productId, type: "products" } },
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

export function deleteSalesInvoice(invoiceId: string) {
  return parasutDelete<void>(`sales_invoices/${invoiceId}`);
}

// Toplu ZIP indirme için (bkz. app/api/orders/parasut-invoices/today-zip). NOT: Paraşüt bu uçta
// "düz" (e-belge olmayan) faturalar için hesapta bir "Yazdırma Şablonu" (PrintTemplate)
// tanımlı olmasını istiyor — tanımlı değilse "Record was not found: PrintTemplate" hatası
// veriyor (2026-09-09'da canlıda tespit edildi, bkz. Ayarlar > Yazdırma Şablonları).
export function getSalesInvoicePdf(invoiceId: string) {
  return parasutGetBinary(`sales_invoices/${invoiceId}.pdf`);
}
