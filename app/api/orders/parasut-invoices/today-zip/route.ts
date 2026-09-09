import { NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { prisma } from "@/db/prisma";
import { getSalesInvoicePdf } from "@/parasut/invoices";
import { getIstanbulTodayRangeUtc } from "@/utils/istanbulTime";

// "Bugün Faturası Kesilenler" listesindeki tüm faturaları TEK bir ZIP'te indirir — her PDF
// posting numarasıyla adlandırılır (2026-09-09, kullanıcı talebi). Paraşüt'ün "düz" (e-belge
// olmayan) faturalar için PDF üretmesi hesapta bir Yazdırma Şablonu tanımlı olmasını istiyor;
// tanımlı değilse hepsi başarısız olur ve bunun net nedeni JSON hata olarak dönülür (zip yerine).
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
      const buffer = await getSalesInvoicePdf(order.parasutInvoiceId);
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
        hint: "Paraşüt hesabınızda bir Yazdırma Şablonu tanımlı olmayabilir (Ayarlar > Yazdırma Şablonları) — API ile oluşturulan faturalar için bu gerekiyor.",
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
