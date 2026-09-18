-- CreateTable
CREATE TABLE "OzonReturn" (
    "id" TEXT NOT NULL,
    "postingNumber" TEXT NOT NULL,
    "offerId" TEXT,
    "productName" TEXT,
    "quantity" INTEGER,
    "reasonName" TEXT,
    "type" TEXT,
    "schema" TEXT,
    "statusName" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "storageFee" DOUBLE PRECISION,
    "utilizationFee" DOUBLE PRECISION,
    "currency" TEXT,
    "compensatedAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OzonReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OzonReturn_postingNumber_idx" ON "OzonReturn"("postingNumber");

-- CreateIndex
CREATE INDEX "OzonReturn_statusChangedAt_idx" ON "OzonReturn"("statusChangedAt");

