import { NextRequest, NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { fetchAndCacheLabel } from "@/ozon/labelCache";
import { OzonApiError } from "@/ozon/client";

// "Toplu Etiket İndir" — app/api/orders/parasut-invoices/today-zip/route.ts ile AYNI desen
// (2026-09-23, kullanıcı talebi). fetchAndCacheLabel önce diske bakıyor — sync-orders-cron.ts'teki
// backfill sayesinde büyük çoğunluk zaten önbelleğe alınmış oluyor, bu yüzden bu uç genelde Ozon'a
// hiç istek atmadan anında biter.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const postingNumbers = Array.isArray(body.postingNumbers) ? body.postingNumbers.filter((p: unknown) => typeof p === "string") : [];

  if (postingNumbers.length === 0) {
    return NextResponse.json({ error: "postingNumbers boş olamaz" }, { status: 400 });
  }

  const labels: Array<{ postingNumber: string; buffer: Buffer }> = [];
  const failures: Array<{ postingNumber: string; error: string }> = [];

  for (const postingNumber of postingNumbers) {
    try {
      const buffer = await fetchAndCacheLabel(postingNumber);
      labels.push({ postingNumber, buffer });
    } catch (error) {
      const message =
        error instanceof OzonApiError && error.message === "INVALID_ARGUMENT"
          ? "Ozon bu sipariş için henüz etiket vermiyor (sadece kargoya hazır durumundayken alınabiliyor)"
          : error instanceof Error
            ? error.message
            : "Etiket alınamadı";
      failures.push({ postingNumber, error: message });
    }
  }

  if (labels.length === 0) {
    return NextResponse.json({ error: "Hiçbir etiket alınamadı", details: failures }, { status: 502 });
  }

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const stream = new PassThrough();
  archive.pipe(stream);

  for (const label of labels) {
    archive.append(label.buffer, { name: `${label.postingNumber}.pdf` });
  }
  if (failures.length > 0) {
    const manifest = failures.map((f) => `${f.postingNumber}: ${f.error}`).join("\n");
    archive.append(manifest, { name: "_alinamayanlar.txt" });
  }
  archive.finalize();

  const dateLabel = new Date().toISOString().slice(0, 10);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="etiketler-${dateLabel}.zip"`,
    },
  });
}
