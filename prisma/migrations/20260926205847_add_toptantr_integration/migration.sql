-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "toptantrApproved" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ToptantrListing" (
    "id" TEXT NOT NULL,
    "shopifyHandle" TEXT NOT NULL,
    "toptantrProductId" TEXT,
    "categoryGuid" TEXT,
    "brandGuid" TEXT,
    "translatedTitle" TEXT,
    "shortDescription" TEXT,
    "fullDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToptantrListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToptantrMappingCache" (
    "key" TEXT NOT NULL,
    "categoryGuid" TEXT,
    "brandGuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToptantrMappingCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ToptantrListing_shopifyHandle_key" ON "ToptantrListing"("shopifyHandle");

