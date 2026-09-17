import { parasut2Get, parasut2Post } from "./aladdinClient";

// KRİTİK (2026-09-17'de canlıda tespit edildi, kullanıcı bulgusu): Aladdin → Fatih Gezgin günlük iç
// faturası, "düz" (item_type "invoice", e-Arşiv/e-Fatura adımı yok) fatura olarak kesiliyordu — bu,
// Ozon'a kesilen yurt dışı/e-Arşiv faturalarla AYNI yöntemdi. Ama Fatih Gezgin'in Paraşüt'teki cari
// kartı artık bir e-Fatura mükellefi kaydı taşıyor (invoicing_preferences.e_invoice_scenario/
// e_invoice_send_to dolu — GİB'e kayıtlı bir e-Fatura posta kutusu var). Türk mevzuatına göre karşı
// taraf e-Fatura mükellefiyse ona düz/e-Arşiv fatura KESİLEMEZ — Paraşüt bu yüzden faturayı ne
// reddetti ne tamamladı, numarasız bir "taslak"ta bıraktı (kullanıcı doğrulaması: "Fatih Gezgin
// e-fatura mükellefi olduğu için bu faturayı kesemedin"). Çözüm: sales_invoice'ı ESKİDEN OLDUĞU GİBİ
// oluşturduktan SONRA, bu dosyadaki adımla onu bir e-Fatura'ya DÖNÜŞTÜRÜYORUZ (eArchives.ts'teki
// createEArchive'e birebir aynı desen — orada e_archives, burada e_invoices).
//
// ÖNEMLİ FARK: e_archives senkron gibi davranıp doğrudan bir e-Arşiv kaydı dönerken, e_invoices
// ASENKRON — POST isteği bir e-Fatura değil, bir "trackable_jobs" (izlenebilir iş) kaydı döner; o iş
// bitene (durumu "done"/"error" olana) kadar AYRICA poll edilmesi gerekiyor. Bu asimetri, Paraşüt'ün
// gerçek API'sini referans alan açık kaynak bir SDK'nın (github.com/yigitkonur/mcp-parasut)
// kaynak kodu okunarak doğrulandı (Paraşüt'ün resmi API dokümantasyonu bir SPA olduğu için
// otomatik okunamıyor).
export type EInvoiceScenario = "basic" | "commercial" | "export";
const E_INVOICE_SCENARIOS: readonly EInvoiceScenario[] = ["basic", "commercial", "export"];

interface TrackableJobResponse {
  data: { id: string; type: "trackable_jobs"; attributes: { status: "pending" | "running" | "done" | "error"; errors?: string[] } };
}

export class EInvoiceJobFailedError extends Error {}
export class EInvoiceJobTimeoutError extends Error {}

// Fatih Gezgin'in cari kartındaki e-Fatura tercihlerini (senaryo + GİB posta kutusu adresi) canlı
// okuyoruz — BİZİM kodumuzda "commercial" gibi sabit bir değer YAZMIYORUZ, çünkü bu tercih Paraşüt
// tarafında (GİB kaydına göre) değişebilir; biz sadece Paraşüt'ün zaten bildiği doğru değeri
// kullanıyoruz. Kayıt yoksa (null döner) — kontak henüz e-Fatura mükellefi DEĞİL demektir, bu
// durumda çağıran taraf eskisi gibi düz faturada kalmalı.
export async function findEInvoicePreferences(
  contactId: string,
): Promise<{ scenario: EInvoiceScenario; to: string } | null> {
  const contact = await parasut2Get<{
    data: { attributes: { invoicing_preferences?: { e_invoice_scenario?: string; e_invoice_send_to?: string } } };
  }>(`contacts/${contactId}`);
  const prefs = contact.data.attributes.invoicing_preferences;
  if (!prefs?.e_invoice_scenario || !prefs?.e_invoice_send_to) return null;
  // submitEInvoiceJob'daki trackable_jobs tip kontrolüyle AYNI gerekçe (2026-09-17 code review'da
  // tespit edildi): Paraşüt ileride bilmediğimiz yeni bir senaryo değeri döndürürse, bunu kör
  // güvenle POST gövdesine taşıyıp Paraşüt'ün genel/teknik hata mesajına düşmek yerine BURADA net
  // bir teşhis hatası fırlatıyoruz.
  if (!E_INVOICE_SCENARIOS.includes(prefs.e_invoice_scenario as EInvoiceScenario)) {
    throw new Error(`Beklenmeyen e-Fatura senaryosu: "${prefs.e_invoice_scenario}" (bilinenler: ${E_INVOICE_SCENARIOS.join(", ")}).`);
  }
  return { scenario: prefs.e_invoice_scenario as EInvoiceScenario, to: prefs.e_invoice_send_to };
}

// Var olan bir sales_invoice'ı e-Fatura'ya dönüştürme isteği başlatır — GERÇEK e-Fatura'yı DEĞİL,
// bunu hazırlayan ASENKRON işin (trackable_job) kimliğini döner (bkz. dosya başı yorumu).
export async function submitEInvoiceJob(salesInvoiceId: string, scenario: EInvoiceScenario, to: string): Promise<string> {
  const res = await parasut2Post<{ data: { id: string; type: string } }>("e_invoices", {
    data: {
      type: "e_invoices",
      attributes: { scenario, to },
      relationships: {
        sales_invoice: { data: { id: salesInvoiceId, type: "sales_invoices" } },
      },
    },
  });
  // Bu asenkron mekanik (POST /e_invoices'ın GERÇEK bir e_invoices değil, bir trackable_jobs
  // döndürmesi) resmi dokümantasyon yerine üçüncü parti bir SDK'nın kaynak kodundan doğrulandı
  // (bkz. dosya başı yorumu) — Paraşüt beklenmedik bir tip dönerse (varsayımımız YANLIŞSA) bunu
  // sessizce "trackable_jobs/{id}" olarak sorgulayıp muhtemelen bir 404 alıp genel bir "başarısız"
  // hatasına düşmek yerine, BURADA net bir teşhis hatası fırlatıyoruz (2026-09-17 code review'da
  // tespit edildi).
  if (res.data.type !== "trackable_jobs") {
    throw new Error(`Beklenmeyen Paraşüt yanıtı: e_invoices isteği "trackable_jobs" yerine "${res.data.type}" tipinde bir kayıt döndürdü.`);
  }
  return res.data.id;
}

// `pollIntervalMs`/`timeoutMs` bilerek e-Arşiv PDF beklemesinden (eArchives.ts) daha KISA tutuluyor
// — bu iş sadece Paraşüt'ün kendi işlemesini (GİB'e ULAŞMASINI değil, sadece kendi tarafında
// e-Fatura kaydını OLUŞTURMASINI) bekliyor, GİB onayı AYRI ve daha yavaş bir adım (bkz.
// findActiveEInvoice'daki "waiting"/"pending" durumu — bu iş bitse bile hâlâ sürebilir). NOT
// (2026-09-17 code review'da tespit edildi): `timeoutMs` sadece BU fonksiyonun kendi bekleme
// döngüsünü sınırlıyor — her `parasut2Get` çağrısının KENDİ İÇİNDEKİ 429 tekrar deneme/backoff'u
// (client.ts, en fazla ~4 deneme × 10sn) ayrı bir bütçe, gerçek en kötü durum süresi bu yüzden
// `timeoutMs`'in belirgin üzerine çıkabilir. Zararı sınırlı: bir zaman aşımı zaten BAŞARISIZLIK
// değil "pending" sayılıyor (bkz. çağıran kod, aladdinInvoice.ts) — sadece daha uzun sürebilir.
export async function pollEInvoiceJob(jobId: string, { pollIntervalMs = 1500, timeoutMs = 30_000 } = {}): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    const res = await parasut2Get<TrackableJobResponse>(`trackable_jobs/${jobId}`);
    const status = res.data.attributes.status;
    if (status === "done") return;
    if (status === "error") {
      throw new EInvoiceJobFailedError((res.data.attributes.errors ?? []).join(", ") || "Paraşüt e-Fatura işi başarısız oldu (sebep belirtilmedi).");
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new EInvoiceJobTimeoutError(`e-Fatura işi ${timeoutMs}ms içinde tamamlanmadı (son durum: ${status}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export interface ActiveEInvoiceInfo {
  status: "waiting" | "pending" | "approved" | "refused" | string;
  invoiceNumber: string | null;
  printableUrl: string | null;
}

// e_invoices işi "done" olduktan SONRA, GERÇEK e-Fatura kaydını (durumu + varsa resmi fatura
// numarasını/yazdırma linkini) okumak için — eArchives.ts'teki findActiveEArchiveId ile AYNI
// include=active_e_document deseni, sadece burada e_archives değil e_invoices tipi aranıyor.
export async function findActiveEInvoice(salesInvoiceId: string): Promise<ActiveEInvoiceInfo | null> {
  const res = await parasut2Get<{
    included?: Array<{ id: string; type: string; attributes?: { status?: string; invoice_number?: string; printable_url?: string } }>;
  }>(`sales_invoices/${salesInvoiceId}?include=active_e_document`);
  const eDoc = res.included?.find((i) => i.type === "e_invoices");
  if (!eDoc) {
    // BURAYA sadece iş "done" olduktan SONRA gelinir (bkz. çağıran kod, aladdinInvoice.ts) — yani
    // normalde ARTIK bir e_invoices kaydı olmalı. Bulunamaması, ya (a) Paraşüt'ün include yanıtındaki
    // gerçek tip adının varsayımımızdan (üçüncü parti bir SDK'dan doğrulandı, resmi dokümandan değil
    // — bkz. dosya başı yorumu) FARKLI olduğu, ya da (b) çok kısa bir tutarlılık gecikmesi anlamına
    // gelebilir — ikisini ayırt edemesek de, bu SESSİZCE geçilirse çağıran kod bunu normal
    // "waiting/pending" GİB gecikmesiyle karıştırıp asla fark edilmezdi (2026-09-17 code review'da
    // tespit edildi).
    console.error(
      `[aladdin-invoice] e-Fatura işi tamamlandı ama sales_invoice ${salesInvoiceId} için include=active_e_document yanıtında "e_invoices" tipinde bir kayıt bulunamadı — Paraşüt'ün gerçek yanıt şekli varsayımımızdan farklı olabilir, Paraşüt panelinden kontrol edin. included: ${JSON.stringify(res.included)}`,
    );
    return null;
  }
  return {
    status: eDoc.attributes?.status ?? "waiting",
    invoiceNumber: eDoc.attributes?.invoice_number || null,
    printableUrl: eDoc.attributes?.printable_url || null,
  };
}
