import { prisma } from "../db/prisma";
import { resolveInvoicePdfForOrder } from "../parasut/eArchives";
import { INVOICE_CLAIM_SENTINEL } from "../parasut/orderInvoice";
import { cacheInvoicePdfIfMissing } from "../parasut/pdfCache";

// Tek seferlik: bu özellik eklenmeden ÖNCE kesilmiş, henüz diske önbelleğe alınmamış faturaları
// geriye dönük olarak indirir (2026-09-10, kullanıcı talebi: "şu an varolan faturaları da
// indirecek misin arka planda"). Sıralı çalışır (Paraşüt'ün hız sınırına takılmamak için) —
// src/parasut/client.ts'teki Retry-After'a saygılı yeniden deneme zaten her sipariş için ayrı ayrı
// koruma sağlıyor. Çalıştırmak için: npx tsx src/scripts/backfill-invoice-pdfs.ts
async function main() {
  const orders = await prisma.order.findMany({
    where: {
      parasutInvoiceId: { not: null },
      parasutInvoicePdfCached: false,
    },
    select: { postingNumber: true, parasutInvoiceId: true },
  });
  const pending = orders.filter((o) => o.parasutInvoiceId && o.parasutInvoiceId !== INVOICE_CLAIM_SENTINEL);

  console.log(`${pending.length} fatura önbelleğe alınacak...`);
  let ok = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const [i, order] of pending.entries()) {
    try {
      const result = await resolveInvoicePdfForOrder(order.postingNumber, order.parasutInvoiceId!);
      if (result.status !== "ready") {
        skipped++;
        console.log(`  [${i + 1}/${pending.length}] ${order.postingNumber}: henüz hazır değil, atlandı`);
        continue;
      }
      await cacheInvoicePdfIfMissing(order.postingNumber, result.pdfUrl);
      ok++;
      console.log(`  [${i + 1}/${pending.length}] ${order.postingNumber}: OK`);
    } catch (err) {
      failures.push(order.postingNumber);
      console.error(`  [${i + 1}/${pending.length}] ${order.postingNumber}: HATA —`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nBitti: ${ok} önbelleğe alındı, ${skipped} henüz hazır değildi, ${failures.length} hata.`);
  if (failures.length > 0) console.log("Hatalı siparişler:", failures.join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERROR", e);
    process.exit(1);
  });
