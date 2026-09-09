import { prisma } from "../db/prisma";
import { getOrderDetail } from "../modules/orders/orders.service";
import { createContact } from "./contacts";
import { createSalesInvoice, listSalesInvoices } from "./invoices";
import { searchProductsByCode, createProduct } from "./products";
import { getUsdToTryRate } from "../pricing/fx-rate";
import { transliterateRussian } from "../utils/transliterate";

// Ozon siparişleri için kullanıcının elle kestiği gerçek faturaların hepsi bu seriden
// (GZN2026000000001, ...000000466 vb. — 2026-09-09'da canlıda doğrulandı; "GZG" serisi ayrı/
// ilgisiz bir iş akışı). Paraşüt API üzerinden fatura oluşturulurken seri+sıra no verilmezse
// fatura numarası atanmıyor (boş kalıyor) — bu yüzden bir sonraki sırayı kendimiz buluyoruz.
const INVOICE_SERIES_PREFIX = "GZN";

function currentInvoiceSeries(): string {
  return `${INVOICE_SERIES_PREFIX}${new Date().getFullYear()}`;
}

// Tam taramayı (yüzlerce fatura, ~19 sayfa) her tıklamada tekrar yapmamak için process ömrü
// boyunca bellekte tutuluyor — ilk çağrıda gerçek Paraşüt verisiyle taranıyor, sonrasında yerel
// olarak artırılıyor. Bu arada Paraşüt panelinden elle aynı seriye fatura kesilirse (nadir,
// buton bunun yerine geçmesi hedeflendiği için) sıra kayabilir — süreç PM2 tarafından periyodik
// yeniden başlatıldığında kendiliğinden düzelir.
let cachedMaxSequence: number | null = null;

// Bu seride şu ana kadar kullanılan en yüksek sıra numarasını bulup bir sonrakini döner.
// Not: eşzamanlı iki "Fatura Kes" tıklaması aynı anda çalışırsa teorik olarak çakışabilir —
// kullanıcının kendi tarif ettiği akış "tek tek, manuel" olduğu için (2026-09-09) bu risk düşük.
async function getNextInvoiceSequence(): Promise<string> {
  if (cachedMaxSequence == null) {
    const series = currentInvoiceSeries();
    let page = 1;
    let maxSeq = 0;
    const pageSize = 25; // Paraşüt'ün izin verdiği maksimum
    while (page <= 60) {
      const { data } = await listSalesInvoices(page, pageSize);
      if (data.length === 0) break;
      for (const inv of data) {
        const no = (inv.attributes as { invoice_no?: string }).invoice_no ?? "";
        if (no.startsWith(series)) {
          const seq = parseInt(no.slice(series.length), 10);
          if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
      }
      page += 1;
      if (data.length < pageSize) break;
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    cachedMaxSequence = maxSeq;
  }
  cachedMaxSequence += 1;
  return String(cachedMaxSequence).padStart(9, "0");
}

interface OrderRawPayload {
  customer?: {
    name?: string;
    address?: { city?: string; region?: string; district?: string; address_tail?: string };
  };
  addressee?: { name?: string };
}

// Ozon'un dummy vergi numarası — gerçek müşterinin TC/vergi no'su Ozon'dan gelmiyor, mevcut
// Paraşüt faturalarında da (kullanıcının elle kestikleri) hep bu placeholder kullanılmış
// (2026-09-09'da 466 gerçek fatura incelenip bu patern doğrulandı).
const FOREIGN_CUSTOMER_TAX_NUMBER = "11111111111";

export class OrderInvoiceError extends Error {}

// Paraşüt her fatura satırında bir "Ürün/Hizmet" kaydı istiyor (boş bırakılırsa "Ürün/hizmet
// doldurulmalı" hatası — 2026-09-09'da canlıda tespit edildi). Aynı Ozon ürünü (offerId=code)
// için mükerrer kayıt açmamak adına önce aranıyor, yoksa oluşturuluyor.
async function findOrCreateParasutProduct(offerId: string, name: string, unitPriceTry: number): Promise<string> {
  const existing = await searchProductsByCode(offerId);
  if (existing.data.length > 0) return existing.data[0].id;

  const created = await createProduct({
    name,
    code: offerId,
    vat_rate: 0,
    unit: "Adet",
    list_price: unitPriceTry,
    currency: "TRL",
  });
  return created.data.id;
}

// Bir Ozon siparişi için Paraşüt'te satış faturası keser — kullanıcının elle kestiği gerçek
// faturalardan (2026-09-09'da incelenen 466 fatura) çıkarılan birebir aynı patern: müşteri adına
// (Latin harfli) yeni bir kontak, TL cinsinden %0 KDV'li fatura, o günün USD/TL kuruyla çevrilmiş
// satır fiyatları. Sipariş zaten daha önce faturalandıysa (Order.parasutInvoiceId dolu) yeniden
// fatura KESMEZ, var olanı döner — buton yanlışlıkla iki kere tıklanırsa mükerrer fatura oluşmasın diye.
export async function createInvoiceForOzonOrder(postingNumber: string) {
  const existing = await prisma.order.findUnique({ where: { postingNumber } });
  if (existing?.parasutInvoiceId) {
    return {
      invoiceId: existing.parasutInvoiceId,
      invoiceNo: existing.parasutInvoiceNo,
      printUrl: existing.parasutPrintUrl,
      alreadyExisted: true,
    };
  }

  const order = await getOrderDetail(postingNumber);
  if (!order) throw new OrderInvoiceError("Sipariş bulunamadı");
  if (order.items.length === 0) throw new OrderInvoiceError("Siparişte kalem yok");

  const raw = order.rawPayload as OrderRawPayload | null;
  const customerName = (raw?.customer?.name || raw?.addressee?.name || "").trim();
  const city = raw?.customer?.address?.city ?? "";
  const district = raw?.customer?.address?.district || raw?.customer?.address?.region || "";
  const addressTail = raw?.customer?.address?.address_tail ?? "";
  if (!customerName) throw new OrderInvoiceError("Sipariş içinde müşteri adı yok, fatura kesilemiyor");

  const rate = await getUsdToTryRate();
  if (!rate) throw new OrderInvoiceError("Güncel USD/TL kuru alınamadı, tekrar deneyin");

  const contactRes = await createContact({
    name: transliterateRussian(customerName).toUpperCase(),
    contact_type: "company",
    account_type: "customer",
    tax_number: FOREIGN_CUSTOMER_TAX_NUMBER,
    city: city ? transliterateRussian(city) : undefined,
    district: district ? transliterateRussian(district) : undefined,
    address: addressTail ? transliterateRussian(addressTail) : undefined,
    invoicing_preferences: { e_document_note: `${postingNumber}\nETGB` },
  });
  const contactId = contactRes.data.id;

  const details = [];
  for (const item of order.items) {
    const name = item.product?.name ?? item.offerId;
    const unitPriceTry = Number((Number(item.price) * rate).toFixed(2));
    const productId = await findOrCreateParasutProduct(item.offerId, name, unitPriceTry);
    details.push({
      quantity: item.quantity,
      unit_price: unitPriceTry,
      vat_rate: 0,
      description: name,
      productId,
    });
  }

  const nextSequence = await getNextInvoiceSequence();
  const issueDate = new Date().toISOString().slice(0, 10);
  const invoiceRes = await createSalesInvoice({
    itemType: "invoice",
    issueDate,
    currency: "TRL",
    contactId,
    description: postingNumber,
    details,
    // BİLİNEN SORUN (2026-09-09, canlıda test edildi): gerçek referans faturalarda invoice_no
    // TEK PARÇA bir string ("GZN2026000000001"), invoice_series/invoice_id ikisi de null —
    // yani Paraşüt'ün kendi web arayüzü bu numarayı API'nin dışında bir mekanizmayla atıyor.
    // API üzerinden ne seri+sıra ayrı gönderilince (araya boşluk koyup sıfır dolgusunu atıyor,
    // "GZN2026 467" gibi) ne de invoice_no doğrudan gönderilince (yok sayılıyor, boş kalıyor)
    // gerçek faturalardaki formatı tam tutturabildik. Şimdilik seri+sıra gönderiliyor — en
    // azından doğru bilgiyi taşıyor, format kullanıcı/muhasebeci tarafından Paraşüt panelinden
    // kolayca düzeltilebilir.
    invoiceSeries: currentInvoiceSeries(),
    invoiceId: nextSequence,
    // cashSale: true denendi ama Paraşüt "hesap bilgisi + ödeme tarihi doldurulmalı" diyor —
    // hangi kasa/banka hesabına işleneceğini bilmediğimiz için (yanlış hesaba yazmak riskli)
    // şimdilik atlanıyor, fatura "unpaid" açılıyor; kullanıcı Paraşüt panelinden tahsilatı
    // işaretleyebilir ya da hangi hesap olduğunu söylerse otomatikleştiririz.
  });

  const invoiceId = invoiceRes.data.id;
  const invoiceNo = (invoiceRes.data.attributes as { invoice_no?: string }).invoice_no ?? null;
  const printUrl = `https://uygulama.parasut.com/${process.env.PARASUT_COMPANY_ID}/sales_invoices/${invoiceId}/print`;

  await prisma.order.update({
    where: { postingNumber },
    data: { parasutInvoiceId: invoiceId, parasutInvoiceNo: invoiceNo, parasutPrintUrl: printUrl },
  });

  return { invoiceId, invoiceNo, printUrl, alreadyExisted: false };
}
