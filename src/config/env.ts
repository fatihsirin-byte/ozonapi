import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  ozonClientId: required("OZON_CLIENT_ID"),
  ozonApiKey: required("OZON_API_KEY"),
  ozonBaseUrl: process.env.OZON_BASE_URL ?? "https://api-seller.ozon.ru",

  // Paraşüt (fatura kesme entegrasyonu) — username/password/companyId henüz elimizde yok,
  // bu yüzden required() ile zorunlu tutulmuyor (yoksa Paraşüt'le alakasız her şey de patlar).
  // Gerçekten kullanılacağı yerde (src/parasut/client.ts) eksikse orada anlamlı hata verilir.
  parasutClientId: process.env.PARASUT_CLIENT_ID,
  parasutClientSecret: process.env.PARASUT_CLIENT_SECRET,
  parasutRedirectUri: process.env.PARASUT_REDIRECT_URI ?? "urn:ietf:wg:oauth:2.0:oob",
  parasutUsername: process.env.PARASUT_USERNAME,
  parasutPassword: process.env.PARASUT_PASSWORD,
  parasutCompanyId: process.env.PARASUT_COMPANY_ID,
  parasutBaseUrl: process.env.PARASUT_BASE_URL ?? "https://api.parasut.com",

  // ASE (xlive.ase.com.tr) gümrük/ETGB entegrasyonu — Paraşüt gibi required() ile zorunlu
  // tutulmuyor, eksikse gerçekten kullanılacağı yerde (src/ase/client.ts) anlamlı hata verilir.
  aseBaseUrl: process.env.ASE_BASE_URL ?? "https://xlive.ase.com.tr/api",
  aseClientId: process.env.ASE_CLIENT_ID,
  aseSecretKey: process.env.ASE_SECRET_KEY,
  // Hiçbir ASE isteğinde kullanılmıyor — kasıtlı: GetToken sadece ClientId/SecretKey/LevelId alıyor,
  // seller id API dokümanında bir istek alanı olarak hiç geçmiyor. Gerçek GetToken çağrısıyla
  // doğrulandı: dönen JWT'nin içine ASE tarafından zaten gömülüyor ("sellerid" claim'i, ClientId'ye
  // bağlı olarak sunucu tarafında belirleniyor) — burada sadece referans/dokümantasyon amaçlı duruyor.
  aseSellerId: process.env.ASE_SELLER_ID,
};
