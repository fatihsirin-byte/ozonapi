-- CreateTable
CREATE TABLE "OzonRfbsReturn" (
    "id" TEXT NOT NULL,
    "postingNumber" TEXT NOT NULL,
    "orderNumber" TEXT,
    "offerId" TEXT,
    "productName" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT,
    "stateCode" TEXT,
    "stateName" TEXT,
    "groupState" TEXT,
    "moneyReturnStateName" TEXT,
    "createdAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OzonRfbsReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OzonRfbsReturn_postingNumber_idx" ON "OzonRfbsReturn"("postingNumber");

-- CreateIndex
CREATE INDEX "OzonRfbsReturn_groupState_idx" ON "OzonRfbsReturn"("groupState");

