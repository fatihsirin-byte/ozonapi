import { prisma } from "../db/prisma";
import { archiveProducts } from "../ozon/products";

// Shopify'dan gelmeyen (yani eski wizard test ürünleri) satırları temizler: Ozon'da arşivler,
// sonra DB'den siler. Sadece shopifyHandle'ı boş olan (yani import akışından gelmeyen) satırları hedefler.
async function main() {
  const testProducts = await prisma.product.findMany({ where: { shopifyHandle: null } });
  console.log(`${testProducts.length} test ürünü bulundu:`, testProducts.map((p) => p.offerId).join(", "));

  const ozonProductIds = testProducts.map((p) => p.ozonProductId).filter((id): id is string => Boolean(id));
  if (ozonProductIds.length > 0) {
    try {
      const { result } = await archiveProducts(ozonProductIds.map(Number));
      console.log("Ozon arşivleme sonucu:", result);
    } catch (e) {
      console.error("Ozon arşivleme başarısız (yine de DB'den siliniyor):", e);
    }
  }

  const { count } = await prisma.product.deleteMany({ where: { shopifyHandle: null } });
  console.log(`${count} ürün DB'den silindi.`);
}

main()
  .catch((e) => {
    console.error("ERROR", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
