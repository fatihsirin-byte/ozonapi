import { env } from "../config/env";

// ASE (xlive.ase.com.tr) — Ozon siparişlerini gümrük/ETGB süreci için ASE'ye bildiren API'nin
// düşük seviye istemcisi. Kimlik bilgileri (.env: ASE_BASE_URL, ASE_CLIENT_ID, ASE_SECRET_KEY)
// gerçek, çalışan bir hesaba ait — bu dosya sadece HTTP çağrılarını sarmalıyor, hiçbir iş
// mantığı içermiyor (bkz. src/ase/orderShipment.ts).

export class AseApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "AseApiError";
  }
}

function requireAseConfig() {
  const missing = (
    [
      ["ASE_CLIENT_ID", env.aseClientId],
      ["ASE_SECRET_KEY", env.aseSecretKey],
    ] as const
  ).filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new AseApiError(`ASE entegrasyonu için eksik .env değişkenleri: ${missing.map(([name]) => name).join(", ")}`, undefined, null);
  }

  return { clientId: env.aseClientId!, secretKey: env.aseSecretKey! };
}

// Doküman hata kod tablosu (Türkçe açıklamalarla) — SendShipment ve diğer uçların döndürdüğü
// "code" alanını okunabilir bir mesaja çevirmek için kullanılıyor.
export const ASE_ERROR_MESSAGES: Record<string, string> = {
  "10": "Başarılı",
  "20": "Hesap pasif ya da tanımlı değil",
  "21": "Hesap geçersiz",
  "22": "Ozon adı sistemde tanımlı değil",
  "31": "Zorunlu bir alan boş olamaz",
  "32": "Belirtilen kod ile kayıt bulunamadı",
  "33": "Ürün listesi eşleşmiyor",
  "34": "Geçersiz Gtip (HS) kodu",
  "35": "shipmentType sadece Courier veya Micro değerlerini alabilir",
  "36": "Courier seçilemez",
  "40": "invoiceUrl veya invoiceBase64String alanlarından biri dolu olmalı",
  "41": "invoiceUrl ve invoiceBase64String alanlarından sadece biri dolu olabilir",
  "42": "Geçersiz dosya uzantısı",
  "43": "Dosya okunamadı",
  "50": "Tek seferde en fazla 50 gönderi gönderilebilir",
  "51": "Tarih aralığı en fazla 1 ay olabilir",
  "99": "Beklenmedik hata",
};

export function describeAseCode(code: string | number | undefined | null): string {
  if (code == null) return "Bilinmeyen sonuç";
  const key = String(code);
  return ASE_ERROR_MESSAGES[key] ?? `Bilinmeyen ASE hata kodu (${key})`;
}

interface AseTokenResponse {
  IsSuccess: boolean;
  Message: string;
  TokenType: string;
  Token: string;
  // Format: "DD.MM.YYYY HH:MM:SS", token alındıktan itibaren ~24 saat geçerli.
  ExpriesDate: string;
  StatusCode: number;
}

// "20.02.2023 19:48:48" (DD.MM.YYYY HH:MM:SS) formatını Date'e çevirir. ASE bu tarihi kendi
// sunucu saatine göre veriyor — hangi saat dilimi olduğu dokümanda belirtilmemiş, ama sadece
// "ne zaman yenilenmeli" kararı için kullanıldığından birkaç dakikalık dilim farkı önemli değil.
function parseAseExpiresDate(value: string): number {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    // Ayrıştırılamazsa güvenli tarafta kal — "hemen dolmuş" say, bir sonraki çağrıda yeniden alınsın.
    console.error(`[ase] ExpriesDate ayrıştırılamadı: "${value}"`);
    return Date.now();
  }
  const [, day, month, year, hour, minute, second] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
}

// Bellek içi token önbelleği — Paraşüt client'ındaki pattern gibi (bkz. src/parasut/client.ts)
// tek process içinde paylaşılıyor. Süresi dolmadan (güvenlik payı olarak 1 saat erken) tekrar
// alınıyor — token ~24 saat geçerli, bu yüzden "yaklaşık 23 saat sonra yenile" isteğine karşılık
// geliyor. Aynı anda birden fazla çağrı token isteğini tetiklerse hepsi AYNI in-flight isteği
// bekler (single-flight) — Paraşüt entegrasyonunda eşzamanlı token isteklerinin sessizce
// başarısız olabildiği tespit edilmişti (bkz. aynı yorum, src/parasut/client.ts).
let cachedToken: { token: string; expiresAt: number } | null = null;
let inFlightTokenRequest: Promise<string> | null = null;

const SAFETY_MARGIN_MS = 60 * 60 * 1000; // 1 saat

async function fetchToken(): Promise<string> {
  const config = requireAseConfig();

  const response = await fetch(`${env.aseBaseUrl}/Token/GetToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ClientId: config.clientId, SecretKey: config.secretKey, LevelId: "1" }),
  });

  const data = (await response.json().catch(() => null)) as AseTokenResponse | null;
  if (!response.ok || !data?.IsSuccess || !data.Token) {
    throw new AseApiError(data?.Message || `ASE token alınamadı (HTTP ${response.status})`, response.status, data);
  }

  cachedToken = {
    token: data.Token,
    expiresAt: parseAseExpiresDate(data.ExpriesDate) - SAFETY_MARGIN_MS,
  };
  return cachedToken.token;
}

export async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }
  if (!inFlightTokenRequest) {
    inFlightTokenRequest = fetchToken().finally(() => {
      inFlightTokenRequest = null;
    });
  }
  return inFlightTokenRequest;
}

async function aseRequest<T>(path: string, body: unknown): Promise<T> {
  const token = await getToken();
  const response = await fetch(`${env.aseBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || data === null) {
    throw new AseApiError(`ASE isteği başarısız (HTTP ${response.status}): ${path}`, response.status, data);
  }
  return data;
}

export interface AseShipmentProduct {
  articleCode: string;
  hsCode: string;
  unitPrice: number;
  productOriginCountryCode: string;
}

export interface SendShipmentPayload {
  code: string;
  shipmentType: string;
  invoiceDate: string;
  invoiceNo: string;
  invoiceCurrencyCode: string;
  invoiceBase64String: string;
  invoiceUrl: string;
  invoiceFileExtension: string;
  invoiceValueofOther?: number;
  shipmentProductList: AseShipmentProduct[];
}

export interface SendShipmentResponse {
  isSuccess: boolean;
  message: string;
  code: string;
}

// Doküman kendi içinde tutarsız: GetToken yanıtı PascalCase (IsSuccess/Message) kullanırken
// SendShipment örnek yanıtı camelCase (isSuccess/message) gösteriyor. Gerçek yanıt hangisini
// kullanırsa kullansın (ya da ikisini karışık verirse) doğru okuyabilmek için her iki adlandırmayı
// da kabul ediyoruz — bkz. code-review bulgusu: yanlış tahmin edilirse her gerçek gönderim
// "Bilinmeyen sonuç" ile sessizce başarısız olarak kaydedilirdi.
function normalizeSendShipmentResponse(data: unknown): SendShipmentResponse {
  const raw = (data ?? {}) as Record<string, unknown>;
  const isSuccess = raw.isSuccess ?? raw.IsSuccess;
  const message = raw.message ?? raw.Message;
  const code = raw.code ?? raw.Code ?? raw.StatusCode;
  return {
    isSuccess: Boolean(isSuccess),
    message: typeof message === "string" ? message : "",
    code: code == null ? "" : String(code),
  };
}

// TODO (dokümanla çelişki, ÇÖZÜLMEDİ — bkz. görev talimatı): element tablosu ve hata kod 35
// shipmentType için sadece "Courier" veya "Micro" kabul edildiğini söylüyor, ama dokümandaki
// request örneğinde "shipmentType":"Etgb" kullanılmış. Gerçek ilk canlı testte hangisinin doğru
// olduğu ayrıca doğrulanacak — bu değeri TEK bir yerden değiştirebilmek için sabit olarak dışa
// açıyoruz, sendShipment içindeki mantığı DEĞİŞTİRMEDEN sadece bu değeri güncellemek yeterli.
export const ASE_SHIPMENT_TYPE = "Etgb";

export async function sendShipment(payload: SendShipmentPayload): Promise<SendShipmentResponse> {
  const data = await aseRequest<unknown>("/Shipment/SendShipment", payload);
  return normalizeSendShipmentResponse(data);
}

// Doküman yanıtın tam şeklini net vermiyor ("item_code: OrderNumber, OrderDate, OrderFileDoc,
// OrderCurrencyCode, Quantity, ProductOriginCountrycode, UnitPrice, HSCode" — hangi alanların
// eksik olduğunu döndüğü belirtiliyor ama JSON şeması örneklenmemiş). Şu an zorunlu bir akışta
// kullanılmadığından ham yanıtı olduğu gibi (unknown) döndürüyoruz — gerçek bir yanıt görüldüğünde
// tipi daraltmak gerekecek.
export function checkShipmentsHasMissingDataByCodeList(codes: string[]): Promise<unknown> {
  return aseRequest<unknown>("/Shipment/CheckShipmentsHasMissingDataByCodeList", {
    CodeList: codes.map((code) => ({ code })),
  });
}
