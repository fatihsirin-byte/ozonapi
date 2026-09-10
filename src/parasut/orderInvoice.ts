import { prisma } from "../db/prisma";
import { getOrderDetail } from "../modules/orders/orders.service";
import { createContact } from "./contacts";
import { createSalesInvoice, updateSalesInvoiceNote } from "./invoices";
import { createEArchive } from "./eArchives";
import { searchProductsByCode, createProduct, updateProduct } from "./products";
import { getUsdToTryRate } from "../pricing/fx-rate";
import { transliterateRussian } from "../utils/transliterate";

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

// Yarış durumu koruması: aynı sipariş için iki istek (çift tıklama, iki açık sekme) neredeyse aynı
// anda gelirse, ikisi de "henüz faturalanmamış" görüp GERÇEK, ayrı iki fatura kesebilir (2026-09-09'da
// code review ile tespit edildi) — bu proje için özellikle riskli, çünkü gerçek faturalar silinemiyor
// (bkz. proje kuralı). Bu yüzden işe başlamadan önce parasutInvoiceId'yi atomik olarak bu sentinel
// değere çekiyoruz; DB bunu tek bir isteğe garanti eder, ikinci istek claim.count === 0 görüp geri çekilir.
export const INVOICE_CLAIM_SENTINEL = "PENDING";

// Paraşüt her fatura satırında bir "Ürün/Hizmet" kaydı istiyor (boş bırakılırsa "Ürün/hizmet
// doldurulmalı" hatası — 2026-09-09'da canlıda tespit edildi). Aynı Ozon ürünü (offerId=code)
// için mükerrer kayıt açmamak adına önce aranıyor, yoksa oluşturuluyor.
//
// ÖNEMLİ (2026-09-09'da canlı faturada tespit edildi): Paraşüt, fatura PDF'inde satırın adını
// bizim gönderdiğimiz "description"dan değil, bağlı ÜRÜN kaydının kendi "name" alanından
// basıyor. Bu ürün daha önce (transliterasyon eklenmeden önceki bir testte) Kiril harfli adla
// oluşmuşsa, biz artık doğru Latin adı gönderiyor olsak bile PDF'te hâlâ eski Kiril ad çıkıyordu
// — bu yüzden var olan kayıt bulunduğunda adı güncel değilse Paraşüt'te güncelleniyor.
async function findOrCreateParasutProduct(offerId: string, name: string, unitPriceTry: number): Promise<string> {
  const existing = await searchProductsByCode(offerId);
  if (existing.data.length > 0) {
    const product = existing.data[0];
    if (product.attributes.name !== name) {
      // Sadece katalog adını günceller — başarısız olsa bile (2026-09-09'da code review'da
      // tespit edildi) gerçek faturanın kesilmesini ENGELLEMEMELİ, bu yüzden ayrı try/catch'te.
      // NOT: PUT'un Paraşüt'te kısmi mi tam değişim mi olduğu doğrulanamadığı için (aynı
      // incelemede tespit edildi) sadece "name" değil, bizim de yazma isteğinde kullandığımız
      // BİLİNEN alanlar birlikte gönderiliyor — ham product.attributes'i olduğu gibi spread etmek
      // Paraşüt'ün döndürdüğü, bizim yazmamıza izin vermeyen ekstra alanları da taşıyıp isteğin
      // reddedilmesine yol açabilirdi (2026-09-10'da ikinci bir code review'da tespit edildi).
      try {
        await updateProduct(product.id, {
          name,
          code: product.attributes.code,
          vat_rate: product.attributes.vat_rate,
          unit: product.attributes.unit,
          list_price: product.attributes.list_price,
          currency: product.attributes.currency,
        });
      } catch (err) {
        console.error(`[parasut] Ürün adı güncellenemedi (product ${product.id}, offerId ${offerId}):`, err);
      }
    }
    return product.id;
  }

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
  const claim = await prisma.order.updateMany({
    where: { postingNumber, parasutInvoiceId: null },
    data: { parasutInvoiceId: INVOICE_CLAIM_SENTINEL },
  });

  if (claim.count === 0) {
    const current = await prisma.order.findUnique({ where: { postingNumber } });
    if (!current) throw new OrderInvoiceError("Sipariş bulunamadı");
    if (current.parasutInvoiceId === INVOICE_CLAIM_SENTINEL) {
      throw new OrderInvoiceError(
        "Bu sipariş için fatura kesme işlemi az önce başka bir istekle başlatıldı, birkaç saniye sonra tekrar deneyin",
      );
    }
    return {
      invoiceId: current.parasutInvoiceId,
      invoiceNo: current.parasutInvoiceNo,
      printUrl: current.parasutPrintUrl,
      alreadyExisted: true,
      eArchiveFailed: current.parasutEArchiveFailed,
    };
  }

  try {
    return await doCreateInvoiceForOzonOrder(postingNumber);
  } catch (err) {
    // Claim'i geri bırak ki hata sonrası tekrar denenebilsin (yoksa sipariş sonsuza dek
    // "PENDING" sentinel'inde takılı kalır, ne fatura kesilir ne buton tekrar aktif olur).
    await prisma.order.update({ where: { postingNumber }, data: { parasutInvoiceId: null } }).catch(() => {});
    throw err;
  }
}

async function doCreateInvoiceForOzonOrder(postingNumber: string) {
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

  // Kullanıcı talebi (2026-09-09): "AI ile çevirmeye gerek yok, tek kural Kiril değil Latin harfi
  // olması" — bu yüzden anlam çevirisi değil, sadece transliterateRussian (aynı müşteri adı/
  // adresinde kullanılan) uygulanıyor; Ozon'dan doğrudan gelen ürünlerde name Kiril olabiliyor.
  const details = [];
  for (const item of order.items) {
    const rawName = item.product?.name ?? item.offerId;
    const name = transliterateRussian(rawName);
    const unitPriceTry = Number((Number(item.price) * rate).toFixed(2));
    const productId = await findOrCreateParasutProduct(item.offerId, name, unitPriceTry);
    details.push({
      quantity: item.quantity,
      unit_price: unitPriceTry,
      vat_rate: 0,
      vatExemptionCode: "301", // KDVK Md. 11/1-a, mal ihracatı istisnası (2026-09-09, kullanıcı talebi)
      description: name,
      productId,
    });
  }

  // ÖNEMLİ (2026-09-09'da muhasebeci geri bildirimiyle tespit edildi): "301 - 11/1-a Mal İhracatı"
  // ibaresini fatura notuna KENDİMİZ eklersek, Paraşüt zaten aynı metni (vat_exemption_reason_code
  // sayesinde) "Vergi İstisna Muafiyet Sebebi: 301 - 11/1-a Mal İhracatı" olarak otomatik bastığı
  // için PDF'te iki kere görünüyor. Bu yüzden fatura notu alanına SADECE bu sabit metin yazılıyor
  // (2026-09-10, kullanıcı talebi: gerçek ETGB numarası DEĞİL, "ETGB - Sipariş no" formatında
  // düz metin — ETGB numarasını fatura kesilirken ayrıca çekmeye gerek yok).
  const invoiceNote = `ETGB - ${postingNumber}`;

  const issueDate = new Date().toISOString().slice(0, 10);
  // ÖNEMLİ (2026-09-10'da canlıda doğrulandı, showSalesInvoice ile birebir sorgulanarak): burada
  // kendi seri/sıra numaramızı GÖNDERMİYORUZ — daha önce "GZN2026 470" gibi kendimiz bir numara
  // atamaya çalışıyorduk, ama e-Arşiv oluşunca (aşağıdaki createEArchive) Paraşüt zaten GİB'e
  // kayıtlı KENDİ resmi e-Arşiv serisine göre faturayı YENİDEN NUMARALANDIRIYOR (ör.
  // "GZ02026000000004") ve bizim gönderdiğimiz seri/sıra tamamen yok sayılıyor. Yani bizim
  // numaralandırma çabamızın gerçek faturada hiçbir karşılığı yoktu — kullanıcı talebiyle (2026-09-10:
  // "bırak Paraşüt doğrusunu yapsın, müdahale etme") tamamen kaldırıldı; numarayı Paraşüt kendi
  // atıyor, biz aşağıda e-Arşiv başarılı olduktan sonra GERÇEK invoice_no'yu okuyup kaydediyoruz.
  const invoiceRes = await createSalesInvoice({
    itemType: "invoice",
    issueDate,
    currency: "TRL",
    contactId,
    // Paraşüt listesinde "Fatura İsmi" olarak görünüyor — sipariş no burada olunca Ozon
    // siparişiyle eşleştirmek/aramak kolaylaşıyor.
    description: postingNumber,
    invoiceNote,
    details,
    // Yurt dışı müşteri — automation-nextjs projesindeki çalışan entegrasyonda da bu alan
    // e-Arşiv/istisna işlenmesi için true gönderiliyor (2026-09-09).
    isAbroad: true,
    // cashSale: true denendi ama Paraşüt "hesap bilgisi + ödeme tarihi doldurulmalı" diyor —
    // hangi kasa/banka hesabına işleneceğini bilmediğimiz için (yanlış hesaba yazmak riskli)
    // şimdilik atlanıyor, fatura "unpaid" açılıyor; kullanıcı Paraşüt panelinden tahsilatı
    // işaretleyebilir ya da hangi hesap olduğunu söylerse otomatikleştiririz.
  });

  const invoiceId = invoiceRes.data.id;
  const invoiceNo = (invoiceRes.data.attributes as { invoice_no?: string }).invoice_no ?? null;
  const printUrl = `https://uygulama.parasut.com/${process.env.PARASUT_COMPANY_ID}/sales_invoices/${invoiceId}/print`;

  // KRİTİK ADIM: yalnızca sales_invoices oluşturmak faturayı TASLAK'ta bırakıyor — resmi
  // e-Arşiv'e dönüşmesi (GİB'e gidip QR/ETTN kazanması, KDV istisnasının gerçekten işlenmesi)
  // için ayrı bir e_archives isteği gerekiyor (bkz. src/parasut/eArchives.ts, 2026-09-09'da
  // automation-nextjs referans projesinde bulundu). Bu adım başarısız olursa fatura yine de
  // Paraşüt'te oluşmuş olur (taslak) — hatayı yutmuyoruz, kullanıcıya "e-Arşiv adımı başarısız"
  // diye bildiriyoruz ki panelden manuel tamamlayabilsin.
  let eArchiveFailed = false;
  try {
    await createEArchive(invoiceId);
    // NOT: e-Arşiv oluşunca Paraşüt faturayı GİB'e kayıtlı KENDİ resmi seriyle yeniden
    // numaralandırıyor (bkz. yukarıdaki createSalesInvoice yorumu) — ama bu renumaralandırma GİB
    // tarafında ANINDA olmuyor (bkz. src/parasut/eArchives.ts resolveInvoicePdf — PDF'in de aynı
    // şekilde "hemen hazır olmayabileceği" zaten ele alınıyor). Bu yüzden gerçek invoice_no'yu
    // BURADA hemen okumuyoruz (bayat/geçici bir değer dönebilirdi, 2026-09-10'da code review'da
    // tespit edildi) — bunun yerine PDF gerçekten "hazır" olduğu anda (en güvenilir sinyal)
    // app/api/orders/[postingNumber]/parasut-invoice/pdf/route.ts güncel numarayı okuyup kaydeder.
  } catch (err) {
    eArchiveFailed = true;
    console.error(`[parasut] e-Arşiv oluşturma başarısız (invoice ${invoiceId}, posting ${postingNumber}):`, err);
    // e-Arşiv başarısız olursa "Vergi İstisna Muafiyet Sebebi: 301 - 11/1-a Mal İhracatı" metnini
    // otomatik basacak başka bir yer kalmıyor (bkz. invoices.ts updateSalesInvoiceNote yorumu) —
    // notu yedekten bu metinle güncelliyoruz. Bu da başarısız olursa faturanın kesilmesini
    // engellemez, sadece loglanır (kullanıcı zaten eArchiveFailed uyarısını görecek).
    try {
      const fallbackNote = invoiceNote ? `${invoiceNote}\n301 - 11/1-a Mal İhracatı` : "301 - 11/1-a Mal İhracatı";
      await updateSalesInvoiceNote(invoiceId, fallbackNote);
    } catch (noteErr) {
      console.error(`[parasut] Yedek istisna notu yazılamadı (invoice ${invoiceId}):`, noteErr);
    }
  }

  await prisma.order.update({
    where: { postingNumber },
    data: {
      parasutInvoiceId: invoiceId,
      parasutInvoiceNo: invoiceNo,
      parasutPrintUrl: printUrl,
      parasutInvoicedAt: new Date(),
      parasutEArchiveFailed: eArchiveFailed,
      // Fatura satırları bu kurla TL'ye çevrildi (yukarıda) — TL satış tutarını siparişler
      // listesinde GERÇEK faturayla birebir eşleşecek şekilde kalıcı göstermek için saklanıyor
      // (2026-09-10, kullanıcı talebi — bkz. app/orders/page.tsx "TL Satış Fiyatı" sütunu).
      parasutInvoiceFxRate: rate,
    },
  });

  return { invoiceId, invoiceNo, printUrl, alreadyExisted: false, eArchiveFailed };
}
