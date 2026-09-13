// Hem sunucu tarafında (src/ase/orderShipment.ts) hem istemci bileşeninde
// (app/orders/[postingNumber]/AseShipmentButton.tsx) kullanılıyor — bağımlılığı olmayan ayrı bir
// dosyada tutuluyor ki client component prisma/db gibi sunucuya özel kod içeren orderShipment.ts'i
// import etmek zorunda kalmasın (2026-09-13 code review'da tespit edildi: sabit iki yerde ayrı ayrı
// tanımlıysa biri değişip diğeri unutulabilir).
export const HSCODE_ERROR_CODE = "34";
