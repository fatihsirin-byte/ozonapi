-- OrderItem: aynı siparişte aynı offerId'nin tekrar oluşturulmaması için (re-sync sırasında delete+recreate yerine upsert'e izin verir)
CREATE UNIQUE INDEX "OrderItem_orderId_offerId_key" ON "OrderItem"("orderId", "offerId");

-- FinanceTransaction: Ozon operation_id'sini sakla, tekrar senkronizasyonda duplicate satır oluşmasını engelle
ALTER TABLE "FinanceTransaction" ADD COLUMN "operationId" BIGINT;
UPDATE "FinanceTransaction" SET "operationId" = 0 WHERE "operationId" IS NULL;
ALTER TABLE "FinanceTransaction" ALTER COLUMN "operationId" SET NOT NULL;
CREATE UNIQUE INDEX "FinanceTransaction_operationId_key" ON "FinanceTransaction"("operationId");
