-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "ozonProductId" TEXT,
    "name" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "oldPrice" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "weightGrams" INTEGER,
    "descriptionCategoryId" INTEGER,
    "typeId" INTEGER,
    "images" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "postingNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "offerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" TEXT NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceTransaction" (
    "id" TEXT NOT NULL,
    "postingNumber" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "operationDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION,
    "deliveryCharge" DOUBLE PRECISION,
    "otherCharges" DOUBLE PRECISION,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_offerId_key" ON "Product"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_postingNumber_key" ON "Order"("postingNumber");

-- CreateIndex
CREATE INDEX "FinanceTransaction_postingNumber_idx" ON "FinanceTransaction"("postingNumber");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_postingNumber_fkey" FOREIGN KEY ("postingNumber") REFERENCES "Order"("postingNumber") ON DELETE RESTRICT ON UPDATE CASCADE;
