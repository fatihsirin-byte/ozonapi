-- Ozon eski /v3/finance/transaction/list uç noktasını kapattı (bkz. schema.prisma yorumu).
-- Yeni /v1/finance/accrual/postings operation_id vermiyor, bu yüzden operationId artık nullable
-- ve unique değil (idempotentlik artık senkronize edilen postingNumber için satırları silip
-- yeniden yazarak sağlanıyor, bkz. finance.service.ts syncAccrualsForPostings).
DROP INDEX "FinanceTransaction_operationId_key";
ALTER TABLE "FinanceTransaction" ALTER COLUMN "operationId" DROP NOT NULL;
ALTER TABLE "FinanceTransaction" ADD COLUMN "currency" TEXT;
