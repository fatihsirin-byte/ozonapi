-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "descriptionRu" TEXT,
ADD COLUMN     "modelGroupId" TEXT,
ADD COLUMN     "nameRu" TEXT,
ADD COLUMN     "originalImages" JSONB,
ADD COLUMN     "shopifyHandle" TEXT,
ADD COLUMN     "shopifyMetafields" JSONB,
ADD COLUMN     "shopifyVariantId" TEXT;

-- CreateTable
CREATE TABLE "ModelGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_shopifyHandle_idx" ON "Product"("shopifyHandle");

-- CreateIndex
CREATE INDEX "Product_modelGroupId_idx" ON "Product"("modelGroupId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_modelGroupId_fkey" FOREIGN KEY ("modelGroupId") REFERENCES "ModelGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
