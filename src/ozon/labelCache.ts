import { mkdir, readFile, writeFile, rename } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { prisma } from "../db/prisma";
import { getFbsPackageLabel } from "./orders";

// src/parasut/pdfCache.ts'teki AYNI desen (2026-09-23, kullanıcı bulgusu: "etiket yazdır diyince
// 4-5 saniye bekliyor bence ozona gidip soruyor" — doğru, her tıklamada Ozon'a canlı istek
// atılıyordu). Etiketler de gerçek müşteri adı/adres/barkod içeriyor — public/uploads yerine
// BİLEREK ayrı, auth gerektiren bir klasörde tutuluyor.
const LABEL_CACHE_DIR = path.join(process.cwd(), "private-uploads", "ozon-labels");

function labelPathFor(postingNumber: string): string {
  // pdfCache.ts'teki AYNI çakışma önleme gerekçesi — bkz. o dosyadaki yorum.
  const safeName = postingNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  const hash = crypto.createHash("sha256").update(postingNumber).digest("hex").slice(0, 8);
  return path.join(LABEL_CACHE_DIR, `${safeName}-${hash}.pdf`);
}

export async function readCachedLabel(postingNumber: string): Promise<Buffer | null> {
  try {
    return await readFile(labelPathFor(postingNumber));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error(`[ozon] Önbellekteki etiket okunamadı (posting ${postingNumber}):`, err);
    }
    return null;
  }
}

// pdfCache.ts'teki writeAtomic ile AYNI gerekçe — yarım/bozuk bir dosyanın servis edilmesini önler.
async function writeAtomic(finalPath: string, buffer: Buffer): Promise<void> {
  await mkdir(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.tmp-${crypto.randomUUID()}`;
  await writeFile(tmpPath, buffer);
  await rename(tmpPath, finalPath);
}

async function saveCachedLabel(postingNumber: string, buffer: Buffer): Promise<void> {
  await writeAtomic(labelPathFor(postingNumber), buffer);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await prisma.order.update({ where: { postingNumber }, data: { shippingLabelCached: true } });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  console.error(`[ozon] Etiket diske kaydedildi ama Order.shippingLabelCached işaretlenemedi (posting ${postingNumber}):`, lastErr);
}

// pdfCache.ts'teki fetchAndCacheInvoicePdf ile AYNI eşzamanlılık koruması — "Etiket Yazdır"
// butonu, toplu ZIP indirme ve arka plan backfill cron'u AYNI anda aynı siparişe denk gelebilir.
const inFlightFetches = new Map<string, Promise<Buffer>>();

export async function fetchAndCacheLabel(postingNumber: string): Promise<Buffer> {
  const existing = inFlightFetches.get(postingNumber);
  if (existing) return existing;

  const task = (async () => {
    const cached = await readCachedLabel(postingNumber);
    if (cached) return cached;
    const buffer = await getFbsPackageLabel(postingNumber);
    await saveCachedLabel(postingNumber, buffer);
    return buffer;
  })().finally(() => {
    inFlightFetches.delete(postingNumber);
  });

  inFlightFetches.set(postingNumber, task);
  return task;
}
