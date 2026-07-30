-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "shopifyType" TEXT;

-- CreateIndex
CREATE INDEX "Product_shopifyType_idx" ON "Product"("shopifyType");
