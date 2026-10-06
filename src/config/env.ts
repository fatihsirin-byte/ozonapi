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

  // Aladdin'in AYRI (ikinci) Paraşüt hesabı — Fatih Gezgin'e günlük iç fatura kesmek için
  // (2026-09-16, kullanıcı talebi). Aynı base URL/redirect URI'yi paylaşıyor, sadece kimlik
  // bilgileri ve şirket id'si farklı.
  parasut2ClientId: process.env.PARASUT2_CLIENT_ID,
  parasut2ClientSecret: process.env.PARASUT2_CLIENT_SECRET,
  parasut2RedirectUri: process.env.PARASUT2_REDIRECT_URI ?? "urn:ietf:wg:oauth:2.0:oob",
  parasut2Username: process.env.PARASUT2_USERNAME,
  parasut2Password: process.env.PARASUT2_PASSWORD,
  parasut2CompanyId: process.env.PARASUT2_COMPANY_ID,
  parasut2BaseUrl: process.env.PARASUT2_BASE_URL ?? process.env.PARASUT_BASE_URL ?? "https://api.parasut.com",

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

  // Shopify (B2C mağaza, omg-silk) — stok "source of truth" senkronu için (2026-09-26, kullanıcı
  // kararı). Paraşüt/ASE gibi required() ile zorunlu tutulmuyor, henüz kullanılmadığı yerlerde
  // proje patlamasın diye — gerçekten kullanılacağı yerde (src/shopify/client.ts) eksikse orada
  // anlamlı hata verilir.
  shopifyStoreDomain: process.env.SHOPIFY_STORE_DOMAIN, // örn. "omg-silk" (myshopify.com öncesi kısım)
  shopifyAdminApiToken: process.env.SHOPIFY_ADMIN_API_TOKEN,
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-04",
  // Stoğun çekileceği lokasyon — Ozon/toptantr'a gönderilecek gerçek depo (İstanbul), Dallas HQ
  // stoğu bu senkronun kapsamı DIŞINDA (o ABD deposu, Ozon/toptantr Türkiye'den gönderiyor).
  shopifyStockLocationId: process.env.SHOPIFY_STOCK_LOCATION_ID, // örn. "gid://shopify/Location/66272723182"

  // toptantr — VPS'teki (72.62.93.209) mevcut "toptantr-shopify-sync" projesinden taşındı
  // (2026-09-26). Auth: username/password ile /sapi/v1/token'dan Bearer token alınıyor (API key
  // değil) — bkz. src/toptantr/client.ts. required() ile zorunlu tutulmuyor, ozonapi'nin toptantr'la
  // hiç alakasız kısımları (Ozon/ASE/Paraşüt) bu değerler eksikken de çalışabilsin diye.
  toptantrBaseUrl: process.env.TOPTANTR_BASE_URL ?? "https://api.toptantr.com",
  toptantrUsername: process.env.TOPTANTR_USERNAME,
  toptantrPassword: process.env.TOPTANTR_PASSWORD,
  // Fiyatlandırma — VPS'teki orijinal projeyle aynı formül (TL = USD * kur * (1 + marj%)).
  toptantrUsdToTlRate: parseFloat(process.env.TOPTANTR_USD_TO_TL_RATE ?? "46.85"),
  toptantrMarginPercent: parseFloat(process.env.TOPTANTR_MARGIN_PERCENT ?? "0"),
  toptantrDefaultTaxCategory: parseInt(process.env.TOPTANTR_DEFAULT_TAX_CATEGORY ?? "20", 10),

  // Shopify stok senkronu → Ozon/toptantr'a GERÇEK miktarı gönderme anahtarı (2026-09-29,
  // kullanıcı kararı: mimari hazır olsun ama aktif gönderim şimdilik kapalı). Varsayılan false —
  // açıkça "true" verilmeden hiçbir gerçek stok miktarı marketplace'lere PUSH edilmez.
  // NOT: bu anahtar sadece "gerçek miktarı gönder"i kapatır — Shopify'da tükenen (0) bir ürünün
  // Ozon/toptantr'da da kapatılması (stok 0 yapılması) bu anahtardan BAĞIMSIZ, her zaman çalışır
  // (bkz. src/shopify/stockSync.ts) — kullanıcı talebi: "biterse kapansın" istisnası kalıcı, opsiyonel değil.
  ozonStockSyncEnabled: process.env.OZON_STOCK_SYNC_ENABLED === "true",
  toptantrStockSyncEnabled: process.env.TOPTANTR_STOCK_SYNC_ENABLED === "true",
};
