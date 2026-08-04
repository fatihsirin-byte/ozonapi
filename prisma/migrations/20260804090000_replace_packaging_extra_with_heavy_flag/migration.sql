ALTER TABLE "Product" DROP COLUMN "packagingExtraGrams";
ALTER TABLE "Product" ADD COLUMN "heavyPackaging" BOOLEAN NOT NULL DEFAULT false;
