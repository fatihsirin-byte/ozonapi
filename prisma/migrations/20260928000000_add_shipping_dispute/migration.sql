-- Finans Mütabakatı (bkz. app/finans-mutabakat, src/modules/finance/shipping-dispute.service.ts) —
-- Ozon'un gerçek kargo kesintisi extrasmall tarifesinin ($3.3) üzerinde geldiği siparişler için
-- kullanıcının Ozon'a yaptığı itirazın durumunu ve baseline tutarını izler.
ALTER TABLE "Order" ADD COLUMN "shippingDisputeStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "shippingDisputedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "shippingDisputedAmountUsd" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "shippingDisputeResolvedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "shippingDisputeResolvedAmountUsd" DOUBLE PRECISION;

CREATE INDEX "Order_shippingDisputeStatus_idx" ON "Order"("shippingDisputeStatus");
