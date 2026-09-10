import * as readline from "node:readline/promises";
import { prisma } from "../db/prisma";

// "Topla" (shipOrder) denemesi belirsiz kalıp (Ozon'a isteğin ulaşıp ulaşmadığı öğrenilemeyip)
// sipariş kilitli kaldıysa (bkz. Order.shipClaimedAt, src/modules/orders/orders.service.ts) bu
// script kilidi elle temizler. KULLANMADAN ÖNCE Ozon'un kendi panelinden bu siparişin
// GERÇEKTEN paketlenip paketlenmediği kontrol edilmeli — paketlenmişse kilidi temizlemeyin,
// aksi halde "Topla" tekrar tıklanıp GERÇEK bir ikinci sevkiyat isteği gidebilir.
async function main() {
  const postingNumber = process.argv[2];
  if (!postingNumber) {
    console.error("Kullanım: npx tsx src/scripts/clear-stuck-ship-claim.ts <postingNumber>");
    process.exit(1);
  }

  const order = await prisma.order.findUnique({ where: { postingNumber } });
  if (!order) {
    console.error("Sipariş bulunamadı:", postingNumber);
    process.exit(1);
  }
  if (order.shipClaimedAt == null) {
    console.log("Bu sipariş zaten kilitli değil, yapacak bir şey yok.");
    return;
  }

  console.log(`Sipariş: ${postingNumber}`);
  console.log(`Local durum: ${order.status}`);
  console.log(`Kilit zamanı: ${order.shipClaimedAt.toISOString()}`);
  console.log("");

  // İlk yazımda bu soru sadece EKRANA YAZILIYORDU, cevap hiç beklenmiyordu — script her zaman
  // kilidi temizliyordu, sorulan sorudan bağımsız (2026-09-10'da code review'da tespit edildi: bu,
  // tam da bu script'in önlemesi gereken çift sevkiyat riskini bizzat yaratabilirdi). Şimdi gerçek
  // bir onay bekleniyor.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    'Ozon panelinden bu siparişin GERÇEKTEN paketlenmediğini doğruladınız mı? (devam etmek için "evet" yazın): ',
  );
  rl.close();

  if (answer.trim().toLocaleLowerCase("tr") !== "evet") {
    console.log("Onaylanmadı, kilit temizlenmedi.");
    return;
  }

  await prisma.order.update({ where: { postingNumber }, data: { shipClaimedAt: null } });
  console.log("Kilit temizlendi — sipariş artık tekrar \"Topla\" ile denenebilir.");
}

main()
  .catch((e) => {
    console.error("ERROR", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
