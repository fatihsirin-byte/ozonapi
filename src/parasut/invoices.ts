import { parasutGet, parasutPost, parasutPut, parasutDelete } from "./client";

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
  isAbroad?: boolean;
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
        is_abroad: input.isAbroad,
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

// SON GÜVENLİK AĞI (2026-09-23'te canlıda tespit edildi, bkz. orderInvoice.ts'teki
// findExistingParasutInvoice yorumu): orderInvoice.ts createSalesInvoice çağrılırken description
// alanına HER ZAMAN postingNumber'ı yazıyor — bu, Paraşüt'te bu sipariş için zaten kesilmiş bir
// fatura olup olmadığını, kendi DB'mize hiç güvenmeden, doğrudan Paraşüt'ün kendi kaydından
// sorgulamamızı sağlıyor.
//
// ACİL DÜZELTME (2026-09-23'te canlıda, ilk deploy'dan dakikalar sonra tespit edildi): Paraşüt
// "'description' is not a valid filter" diye reddediyor — sales_invices'ta filtrelenebilir alanlar
// SADECE due_date/issue_date/currency/remaining/contact_id/invoice_id/invoice_series/item_type.
// description'a göre arama YAPILAMIYOR. Bunun yerine, faturanın kesildiği GÜNE göre (issue_date —
// createSalesInvoice'ta HER ZAMAN "bugün" yazılıyor, bkz. orderInvoice.ts) filtreleyip, o günün
// (genelde birkaç yüz) faturasını sayfalayarak çekip description eşleşmesini KENDİMİZ (istemci
// tarafında) arıyoruz.
export async function findSalesInvoiceByPostingNumber(
  postingNumber: string,
  issueDate: string,
): Promise<{ id: string; type: "sales_invoices"; attributes: Record<string, unknown> } | null> {
  // Paraşüt page[size] için 25 ÜST SINIRINI kabul ediyor ("page[size] can be maximum 25" —
  // 2026-09-23'te canlıda denenip tespit edildi, 100 denenmişti).
  const pageSize = 25;
  const MAX_PAGES = 20; // 20 x 25 = 500 fatura/gün üst sınırı — güvenlik için, sonsuz döngüye girmesin
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await parasutGet<ParasutSalesInvoiceListResponse>(
      `sales_invoices?filter[issue_date]=${encodeURIComponent(issueDate)}&page[number]=${page}&page[size]=${pageSize}`,
    );
    const match = res.data.find((inv) => (inv.attributes as { description?: string }).description === postingNumber);
    if (match) return match;
    if (res.data.length < pageSize) return null; // son sayfaya gelindi, bulunamadı
  }
  console.error(`[parasut] findSalesInvoiceByPostingNumber: ${MAX_PAGES} sayfa (${MAX_PAGES * pageSize} fatura) tarandı, postingNumber ${postingNumber} bulunamadı — üst sınıra takıldı.`);
  return null;
}

export function showSalesInvoice(invoiceId: string) {
  return parasutGet<ParasutSalesInvoiceResponse>(`sales_invoices/${invoiceId}?include=active_e_document,contact,details.product`);
}

export function deleteSalesInvoice(invoiceId: string) {
  return parasutDelete<void>(`sales_invoices/${invoiceId}`);
}

// "Vergi İstisna Muafiyet Sebebi: 301 - 11/1-a Mal İhracatı" metni normalde e-Arşiv adımı
// (createEArchive) tarafından otomatik basılıyor — biz notta tekrarlarsak PDF'te iki kere
// çıkıyor (2026-09-09'da muhasebeci geri bildirimiyle tespit edildi, bkz. orderInvoice.ts).
// AMA e-Arşiv adımı kalıcı olarak başarısız kalırsa (bkz. resolveInvoicePdf), o zaman bu metni
// basacak başka bir yer kalmıyor — bu fonksiyon o durumda notu yedekten güncellemek için var.
export function updateSalesInvoiceNote(invoiceId: string, invoiceNote: string) {
  return parasutPut<ParasutSalesInvoiceResponse>(`sales_invoices/${invoiceId}`, {
    data: {
      id: invoiceId,
      type: "sales_invoices",
      attributes: { invoice_note: invoiceNote },
    },
  });
}
