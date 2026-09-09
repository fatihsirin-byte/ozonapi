import { listContacts } from "../parasut/contacts";
import { listSalesInvoices } from "../parasut/invoices";

// Paraşüt bağlantısını doğrular — OAuth token alıp basit birer okuma isteği yapar (yazma
// yapmaz). .env'de PARASUT_CLIENT_ID/SECRET/USERNAME/PASSWORD/COMPANY_ID eksikse anlamlı bir
// hata mesajıyla durur (bkz. src/parasut/client.ts requireParasutConfig).
async function main() {
  console.log("Paraşüt kontakları çekiliyor...");
  const contacts = await listContacts(1, 5);
  console.log(`OK — ${contacts.meta?.total_count ?? contacts.data.length} kontak var, ilk ${contacts.data.length} tanesi:`);
  console.log(contacts.data.map((c) => ({ id: c.id, name: c.attributes.name })));

  console.log("\nParaşüt satış faturaları çekiliyor...");
  const invoices = await listSalesInvoices(1, 5);
  console.log(`OK — ${invoices.meta?.total_count ?? invoices.data.length} fatura var.`);
}

main().catch((e) => {
  console.error("ERROR", e.status, e.message, JSON.stringify(e.body));
  process.exit(1);
});
