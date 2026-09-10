import { NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { prisma } from "@/db/prisma";
import { resolveInvoicePdfForOrder } from "@/parasut/eArchives";
import { fetchAndCacheInvoicePdf, readCachedInvoicePdf } from "@/parasut/pdfCache";
import { getIstanbulTodayRangeUtc } from "@/utils/istanbulTime";

// "Bugün Faturası Kesilenler" listesindeki tüm faturaları TEK bir ZIP'te indirir — her PDF
// posting numarasıyla adlandırılır (2026-09-09, kullanıcı talebi). Fatura kesilirken artık
// otomatik olarak e-Arşiv'e dönüştürülüyor (bkz. src/parasut/orderInvoice.ts) — PDF, düz
// sales_invoices'tan değil, o e-Arşiv kaydından (önce presigned S3 linki alınıp, o link AYRICA
// fetch edilerek) çekiliyor; bkz. src/parasut/eArchives.ts (resolveInvoicePdfForOrder, "Faturayı
// Aç" butonuyla ORTAK ve eşzamanlılığa karşı atomik olarak korumalı — bkz. o fonksiyonun yorumu).
export async function GET() {
  const { start, end } = getIstanbulTodayRangeUtc();
  const orders = await prisma.order.findMany({
    where: { parasutInvoicedAt: { gte: start, lt: end } },
    select: { postingNumber: true, parasutInvoiceId: true, parasutInvoiceNo: true },
  });

  if (orders.length === 0) {
    return NextResponse.json({ error: "Bugün kesilmiş fatura yok" }, { status: 404 });
  }

  const pdfs: Array<{ postingNumber: string; buffer: Buffer }> = [];
  const failures: Array<{ postingNumber: string; error: string }> = [];

  for (const order of orders) {
    // Önce diskteki önbelleğe bakılıyor — büyük çoğunluk zaten "Faturayı Aç" butonuyla en az bir
    // kere kontrol edilmiş, dolayısıyla önbelleğe alınmış oluyor. Bu, Paraşüt'e HİÇ istek atmadan
    // anında biter (2026-09-10, kullanıcı talebi — önceden 40 sipariş sırayla Paraşüt'e soruyordu,
    // yoğun günlerde hız sınırına takılıp dakikalarca sürebiliyordu).
    const cached = await readCachedInvoicePdf(order.postingNumber);
    if (cached) {
      pdfs.push({ postingNumber: order.postingNumber, buffer: cached });
      continue;
    }
    if (!order.parasutInvoiceId) continue;
    try {
      // fetchAndCacheInvoicePdf, "Faturayı Aç" butonunun kullandığı AYNI kilitle korunuyor
      // (2026-09-10'da code review'da tespit edildi: önceki sürümde bu rota kendi indirmesini
      // yapıp kilidi atlıyordu, aynı siparişe aynı anda gelen iki istek diski çift yazabiliyordu).
      const result = await resolveInvoicePdfForOrder(order.postingNumber, order.parasutInvoiceId);
      if (result.status === "processing") {
        throw new Error("Fatura henüz e-Arşiv'e dönüşmedi (hâlâ işlemde olabilir)");
      }
      const buffer = await fetchAndCacheInvoicePdf(order.postingNumber, result.pdfUrl);
      pdfs.push({ postingNumber: order.postingNumber, buffer });
    } catch (error) {
      failures.push({ postingNumber: order.postingNumber, error: error instanceof Error ? error.message : "Bilinmeyen hata" });
    }
  }

  if (pdfs.length === 0) {
    return NextResponse.json(
      {
        error: "Hiçbir fatura PDF olarak alınamadı",
        details: failures,
      },
      { status: 502 },
    );
  }

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const stream = new PassThrough();
  archive.pipe(stream);

  for (const pdf of pdfs) {
    archive.append(pdf.buffer, { name: `${pdf.postingNumber}.pdf` });
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
      "Content-Disposition": `attachment; filename="faturalar-${dateLabel}.zip"`,
    },
  });
}
