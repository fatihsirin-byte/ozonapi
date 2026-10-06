-- toptantr'a varyant başına ELLE girilen kademe stoğu (null = floor(tekli stok / adet) türetmesi).
ALTER TABLE "Product" ADD COLUMN "toptantrStockOverride" INTEGER;
