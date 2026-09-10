-- AlterTable
ALTER TABLE "Order" ADD COLUMN "parasutInvoiceNoConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- DropTable (artık kod tarafında hiç kullanılmıyor — bkz. src/parasut/orderInvoice.ts,
-- gerçek fatura numarası artık Paraşüt'ün kendi atadığı değerden okunuyor)
DROP TABLE IF EXISTS "ParasutInvoiceSequence";
