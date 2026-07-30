-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "shopifyVendor" TEXT;

-- CreateIndex
CREATE INDEX "Product_shopifyVendor_idx" ON "Product"("shopifyVendor");
