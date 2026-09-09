import { NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import axios from "axios";
import { prisma } from "@/db/prisma";
import { findActiveEArchiveId, getEArchivePdfUrl, createEArchive } from "@/parasut/eArchives";
import { getIstanbulTodayRangeUtc } from "@/utils/istanbulTime";

// "Bugün Faturası Kesilenler" listesindeki tüm faturaları TEK bir ZIP'te indirir — her PDF
// posting numarasıyla adlandırılır (2026-09-09, kullanıcı talebi). Fatura kesilirken artık
// otomatik olarak e-Arşiv'e dönüştürülüyor (bkz. src/parasut/orderInvoice.ts) — PDF, düz
// sales_invoices'tan değil, o e-Arşiv kaydından (önce presigned S3 linki alınıp, o link AYRICA
// fetch edilerek) çekiliyor; bkz. src/parasut/eArchives.ts.
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
    if (!order.parasutInvoiceId) continue;
    try {
      let eArchiveId = await findActiveEArchiveId(order.parasutInvoiceId);
      // Fatura kesilirken e-Arşiv adımı başarısız olmuş olabilir (ör. geçici Paraşüt hatası) —
      // ZIP indirirken pes etmeden bir kez daha deneyip kendiliğinden düzeltmeyi deniyoruz
      // (2026-09-09, code review'da "yedek yolu yok" bulgusuna karşılık eklendi).
      if (!eArchiveId) {
        try {
          const retryRes = await createEArchive(order.parasutInvoiceId);
          eArchiveId = retryRes.data.id;
        } catch {
          // aşağıda "e-Arşiv'e dönüştürülemedi" olarak raporlanacak
        }
      }
      if (!eArchiveId) throw new Error("Fatura e-Arşiv'e dönüştürülemedi (kesim sırasında ve tekrar denemede başarısız oldu)");
      const pdfUrl = await getEArchivePdfUrl(eArchiveId);
      if (!pdfUrl) throw new Error("e-Arşiv PDF linki alınamadı");
      const pdfResponse = await axios.get<ArrayBuffer>(pdfUrl, { responseType: "arraybuffer" });
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
