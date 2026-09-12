-- AlterTable
ALTER TABLE "Product" ADD COLUMN "gtipOverride" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "aseShipmentSentAt" TIMESTAMP(3),
ADD COLUMN "aseShipmentSuccess" BOOLEAN,
ADD COLUMN "aseShipmentMessage" TEXT;
