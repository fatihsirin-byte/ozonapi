-- FinanceTransaction.postingNumber artık Order'a FK ile bağlı değil (bkz. schema.prisma yorumu) —
-- finans işlemleri senkron penceremiz dışındaki veya hiçbir Order'a düşmeyen posting'lere referans verebiliyor.
ALTER TABLE "FinanceTransaction" DROP CONSTRAINT IF EXISTS "FinanceTransaction_postingNumber_fkey";
