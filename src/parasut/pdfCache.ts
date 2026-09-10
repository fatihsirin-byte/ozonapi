import { mkdir, readFile, writeFile, rename } from "fs/promises";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { prisma } from "../db/prisma";

// Fatura PDF'leri gerçek müşteri adı/adres/tutar içeriyor — public/uploads (auth GEREKTİRMEYEN
// bir klasör, bkz. middleware.ts) yerine BİLEREK ayrı, public/ dışında bir klasörde tutuluyor.
// Sadece app/api/orders/[postingNumber]/parasut-invoice/pdf-file/route.ts üzerinden, giriş
// yapmış kullanıcıya servis ediliyor.
const PDF_CACHE_DIR = path.join(process.cwd(), "private-uploads", "parasut-invoices");

function pdfPathFor(postingNumber: string): string {
  // postingNumber Ozon'dan geliyor, şimdiye kadar hep [A-Za-z0-9-] formatında görüldü ama bu bir
  // garanti değil — sadece harf/rakam dışındakileri "_"e çevirmek TEK BAŞINA iki farklı
  // postingNumber'ı aynı dosya adına düşürebilirdi (2026-09-10'da code review'da tespit edildi:
  // "bir siparişin gerçek fatura PDF'i başka birininkiyle üzerine yazılabilir/karışabilirdi").
  // Orijinal (temizlenmemiş) değerin kısa bir hash'i eklenerek çakışma pratikte imkansız hale
  // getiriliyor, dosya adı yine de okunabilir kalıyor.
  const safeName = postingNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  const hash = crypto.createHash("sha256").update(postingNumber).digest("hex").slice(0, 8);
  return path.join(PDF_CACHE_DIR, `${safeName}-${hash}.pdf`);
}

export interface ReadResult {
  buffer: Buffer | null;
  // true ise dosyanın GERÇEKTEN olmadığı (ENOENT) kesin — false ise okunamadı ama SEBEBİ belirsiz
  // (izin, disk vb.) — çağıranlar bu ikisini KARIŞTIRMAMALI: sadece kesin "yok" durumunda
  // Order.parasutInvoicePdfCached bayrağı sıfırlanmalı/yeniden indirme denenmeli (2026-09-10'da
  // code review'da tespit edildi: geçici bir okuma hatası, hâlâ var olan bir PDF için kullanıcıyı
  // yanlışlıkla Paraşüt paneline yönlendirip önbellek bayrağını bozabiliyordu).
  confirmedMissing: boolean;
}

// Buffer ve "kesin yok mu" bilgisini TEK bir disk okumasında birlikte döner — ikisine de ihtiyaç
// duyan çağıranlar (ör. pdf-file/route.ts) readCachedInvoicePdf + isInvoicePdfConfirmedMissing'i
// AYRI AYRI çağırmamalı, bu aynı dosyayı iki kere okumak anlamına gelirdi (2026-09-10'da code
// review'da tespit edildi).
export async function readCachedInvoicePdfDetailed(postingNumber: string): Promise<ReadResult> {
  try {
    return { buffer: await readFile(pdfPathFor(postingNumber)), confirmedMissing: false };
  } catch (err) {
    const isEnoent = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    if (!isEnoent) {
      console.error(`[parasut] Önbellekteki PDF okunamadı (posting ${postingNumber}):`, err);
    }
    return { buffer: null, confirmedMissing: isEnoent };
  }
}

export async function readCachedInvoicePdf(postingNumber: string): Promise<Buffer | null> {
  return (await readCachedInvoicePdfDetailed(postingNumber)).buffer;
}

// true ise dosya KESİN yok (ENOENT) — false ise ya var ya da geçici bir hata yüzünden şu an
// okunamıyor (bu durumda "yok" varsayılıp önbellek durumunun bozulmaması gerekir).
export async function isInvoicePdfConfirmedMissing(postingNumber: string): Promise<boolean> {
  return (await readCachedInvoicePdfDetailed(postingNumber)).confirmedMissing;
}

// Geçici bir dosyaya yazıp SONRA asıl isme taşıyor (rename POSIX'te atomik) — düz writeFile
// kullanılsaydı, tam o anda okuyan biri (başka bir istek ya da toplu ZIP) yarım/bozuk bir dosya
// görebilirdi (2026-09-10'da code review'da tespit edildi: "gerçek bir finansal belge bozuk
// servis edilebilir").
async function writeAtomic(finalPath: string, buffer: Buffer): Promise<void> {
  await mkdir(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.tmp-${crypto.randomUUID()}`;
  await writeFile(tmpPath, buffer);
  await rename(tmpPath, finalPath);
}

export async function saveCachedInvoicePdf(postingNumber: string, buffer: Buffer): Promise<void> {
  await writeAtomic(pdfPathFor(postingNumber), buffer);
  // Dosya diske başarıyla yazıldıktan SONRA bayrak set edilemezse (geçici DB hatası), dosya
  // önbellekte kalır ama bayrak sonsuza dek false kalırdı — çünkü bir sonraki çağrı dosyayı diskte
  // bulup indirmeyi tekrar denemez (2026-09-10'da code review'da tespit edildi). Birkaç kere
  // denenip yine de olmazsa loglanır — PDF yine de diskte durur, bir sonraki BAŞARILI indirmede
  // (ör. dosya silinip tekrar oluşturulursa) düzelir, ama bu ender durumu görünür kılmak önemli.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await prisma.order.update({ where: { postingNumber }, data: { parasutInvoicePdfCached: true } });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  console.error(`[parasut] PDF diske kaydedildi ama Order.parasutInvoicePdfCached işaretlenemedi (posting ${postingNumber}):`, lastErr);
}

// "Faturayı Aç" butonunun durum kontrolü ile toplu ZIP indirme, henüz önbelleğe alınmamış AYNI
// siparişe neredeyse aynı anda denk gelebilir — HER İKİSİ de bu tek fonksiyonu çağırmalı (2026-09-10'da
// code review'da tespit edildi: ZIP rotası önceki sürümde kendi axios.get'ini yapıp kilidi tamamen
// atlıyordu). Diskin kendisi "gerçek zaten var mı" sorusunun tek kaynağı — DB bayrağına GÜVENMEDEN
// önce her zaman disk kontrol edilir, böylece bayrak yanlışlıkla true ama dosya kayıpsa bile
// kendiliğinden onarılır (self-heal).
const inFlightDownloads = new Map<string, Promise<Buffer>>();

export async function fetchAndCacheInvoicePdf(postingNumber: string, pdfUrl: string): Promise<Buffer> {
  const existing = inFlightDownloads.get(postingNumber);
  if (existing) return existing;

  const task = (async () => {
    const cached = await readCachedInvoicePdf(postingNumber);
    if (cached) return cached;
    const response = await axios.get<ArrayBuffer>(pdfUrl, { responseType: "arraybuffer", timeout: 30_000 });
    const buffer = Buffer.from(response.data);
    await saveCachedInvoicePdf(postingNumber, buffer);
    return buffer;
  })().finally(() => {
    inFlightDownloads.delete(postingNumber);
  });

  inFlightDownloads.set(postingNumber, task);
  return task;
}

// PDF'i Paraşüt'ün geçici (presigned) linkinden BİR KERE indirip diske kaydeder — bundan sonra
// hiçbir yer (buton, toplu ZIP indirme) bu sipariş için tekrar Paraşüt'e sormaz (2026-09-10,
// kullanıcı talebi: "her fatura oluşunca PDF olarak içeri alsak direkt"). Sonucu önemsemeyen
// (sadece önbelleğe almak isteyen) çağıranlar için — bkz. fetchAndCacheInvoicePdf.
export async function cacheInvoicePdfIfMissing(postingNumber: string, pdfUrl: string): Promise<void> {
  await fetchAndCacheInvoicePdf(postingNumber, pdfUrl);
}
