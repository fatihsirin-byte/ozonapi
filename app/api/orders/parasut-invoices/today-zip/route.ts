import { NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import axios from "axios";
import { prisma } from "@/db/prisma";
import { resolveInvoicePdf } from "@/parasut/eArchives";
import { getIstanbulTodayRangeUtc } from "@/utils/istanbulTime";

// "Bugün Faturası Kesilenler" listesindeki tüm faturaları TEK bir ZIP'te indirir — her PDF
// posting numarasıyla adlandırılır (2026-09-09, kullanıcı talebi). Fatura kesilirken artık
// otomatik olarak e-Arşiv'e dönüştürülüyor (bkz. src/parasut/orderInvoice.ts) — PDF, düz
// sales_invoices'tan değil, o e-Arşiv kaydından (önce presigned S3 linki alınıp, o link AYRICA
// fetch edilerek) çekiliyor; bkz. src/parasut/eArchives.ts (resolveInvoicePdf, "Faturayı Aç"
// butonuyla ORTAK — yeniden deneme SADECE parasutEArchiveFailed true iken yapılır, aksi halde
// hâlâ işlemde olan bir e-Arşiv için GERÇEK, ikinci bir GİB başvurusu tetiklenebilir).
export async function GET() {
  const { start, end } = getIstanbulTodayRangeUtc();
  const orders = await prisma.order.findMany({
    where: { parasutInvoicedAt: { gte: start, lt: end } },
    select: { postingNumber: true, parasutInvoiceId: true, parasutInvoiceNo: true, parasutEArchiveFailed: true },
  });

  if (orders.length === 0) {
    return NextResponse.json({ error: "Bugün kesilmiş fatura yok" }, { status: 404 });
  }

  const pdfs: Array<{ postingNumber: string; buffer: Buffer }> = [];
  const failures: Array<{ postingNumber: string; error: string }> = [];

  for (const order of orders) {
    if (!order.parasutInvoiceId) continue;
    try {
      const result = await resolveInvoicePdf(order.parasutInvoiceId, order.parasutEArchiveFailed);
      if (result.status === "processing") {
        throw new Error("Fatura henüz e-Arşiv'e dönüşmedi (hâlâ işlemde olabilir)");
      }
      if (result.recoveredFromFailure) {
        await prisma.order.update({
          where: { postingNumber: order.postingNumber },
          data: { parasutEArchiveFailed: false },
        });
      }
      const pdfResponse = await axios.get<ArrayBuffer>(result.pdfUrl, { responseType: "arraybuffer" });
      pdfs.push({ postingNumber: order.postingNumber, buffer: Buffer.from(pdfResponse.data) });
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
