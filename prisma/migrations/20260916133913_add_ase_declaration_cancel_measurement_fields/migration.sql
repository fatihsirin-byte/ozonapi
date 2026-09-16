-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "aseCancelReason" TEXT,
ADD COLUMN     "aseCancelledAt" TIMESTAMP(3),
ADD COLUMN     "aseCustomDeclarationCode" TEXT,
ADD COLUMN     "aseCustomDeclarationDate" TIMESTAMP(3),
ADD COLUMN     "aseMeasuredWeightKg" DOUBLE PRECISION;

