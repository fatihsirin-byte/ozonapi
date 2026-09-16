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

// ÇÖZÜLDÜ (2026-09-15): dokümandaki "Etgb" örneği yanlışmış — gerçek ilk canlı testte
// (0221854527-0281-1 siparişi) ASE tam olarak "shipmentType can only take Courier or Micro
// values" hatasını döndürdü. Courier kullanmak için müşteri temsilcisinden bilgi alınması
// gerektiği dokümanda belirtiliyor (bkz. Gönderi İşlemleri bölümü) — biz için henüz öyle bir
// anlaşma yok, o yüzden "Micro" (küçük paket/mikro ihracat) varsayılan.
export const ASE_SHIPMENT_TYPE = "Micro";

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

// Aşağıdaki 3 metot — 2026-09-16'da ASE'nin kendi ekibiyle (Devrim Eriş) yapılan görüşme sonrası
// eklendi: "ase api.pdf" (proje kök dizininde, kullanıcının kendi indirdiği güncel API dökümanı)
// dosyasındaki "Gümrük Beyanı" ve "İptal ve Ölçüm" bölümlerinden BİREBİR alınan alan adları
// kullanılıyor.
//
// normalizeSendShipmentResponse'taki AYNI riske karşı (doküman GetToken'da PascalCase
// (IsSuccess/Message), SendShipment örneğinde camelCase (isSuccess/message) gösteriyor — gerçek
// API hangisini kullanırsa kullansın) burada da ortak bir "zarf" (envelope) normalizasyonu
// kullanılıyor. Normalizasyon OLMADAN yazılan ilk sürüm, gerçek yanıt PascalCase gelirse
// isSuccess'i hep undefined okuyup TÜM sorguları sessizce "başarısız" sayardı — özellik hiç
// çalışmadan sessizce hiçbir şey güncellemezdi (2026-09-16 code review'da tespit edildi).
//
// AYNI risk "list" içindeki her bir kaydın alan adları için de geçerli — sadece dış zarfı
// normalize edip liste öğelerini OLDUĞU GİBİ bırakan ilk sürüm, API liste öğelerinde de
// PascalCase dönerse (ör. "Code" yerine "code") o kaydı sessizce "eşleşmeyen"/"henüz hazır değil"
// gibi gösterirdi — en tehlikelisi iptal tespitinde: `item.code` undefined okunursa o sipariş HİÇ
// iptal olarak işaretlenmezdi (2026-09-16, ikinci code review turunda tespit edildi). Bu yüzden
// her kayıt da `itemKeys` listesindeki alanlar için camelCase/PascalCase ikisi de denenerek
// normalize ediliyor.
function normalizeItemFields<T extends Record<string, unknown>>(item: unknown, itemKeys: (keyof T & string)[]): T {
  const raw = (item ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of itemKeys) {
    const pascalKey = key.length > 0 ? key[0]!.toUpperCase() + key.slice(1) : key;
    out[key] = raw[key] ?? raw[pascalKey];
  }
  return out as T;
}

function normalizeAseListEnvelope<T extends Record<string, unknown>>(
  data: unknown,
  itemKeys: (keyof T & string)[],
): { isSuccess: boolean; message: string | null; code: string; list: T[] } {
  const raw = (data ?? {}) as Record<string, unknown>;
  const isSuccess = raw.isSuccess ?? raw.IsSuccess;
  const message = raw.message ?? raw.Message;
  const code = raw.code ?? raw.Code ?? raw.StatusCode;
  const list = raw.list ?? raw.List;
  return {
    isSuccess: Boolean(isSuccess),
    message: typeof message === "string" ? message : null,
    code: code == null ? "" : String(code),
    list: Array.isArray(list) ? list.map((item) => normalizeItemFields<T>(item, itemKeys)) : [],
  };
}

// aseRequest → normalizeAseListEnvelope → başarısızsa fırlat zinciri 3 metotta birebir
// tekrarlanıyordu — bir düzeltmenin (ör. describeAseCode kullanımı) üçünden sadece ikisine
// uygulanıp birinin unutulması riskini taşıyordu (2026-09-16, üçüncü code review turunda tespit
// edildi), o yüzden tek yerden.
async function callAseListEndpoint<T extends Record<string, unknown>>(
  path: string,
  body: unknown,
  itemKeys: (keyof T & string)[],
): Promise<T[]> {
  const raw = await aseRequest<unknown>(path, body);
  const data = normalizeAseListEnvelope<T>(raw, itemKeys);
  if (!data.isSuccess) {
    throw new AseApiError(data.message || describeAseCode(data.code), undefined, raw);
  }
  return data.list;
}

export interface CustomDeclarationDetail {
  code: string;
  // Doküman: "Sorgulanan kodun ASE sisteminde var olup olmadığını gösterir." false ise bu kod
  // ASE'de hiç bulunamamış demektir — customDeclarationCode'un null olması bununla KARIŞTIRILMAMALI
  // (biri "henüz beyan yok", diğeri "ASE bu siparişi hiç tanımıyor").
  isAvailableCode: boolean;
  isShipmentTypeEtgb: boolean;
  // Doküman: "Beyan işlemi tamamlandı ise burada numarası olacaktır, null ise henüz beyan işlemi
  // tamamlanmamıştır."
  customDeclarationCode: string | null;
  customDeclarationDate: string | null;
}

// Bir kerede en fazla 50 kod sorgulanabilir (doküman) — çağıran taraf (statusPolling.ts) bunu
// böler.
export function getCustomDeclarationDetailsByCodeList(codes: string[]): Promise<CustomDeclarationDetail[]> {
  return callAseListEndpoint<CustomDeclarationDetail>(
    "/Shipment/GetCustomDeclarationDetailsByCodeList",
    { CodeList: codes.map((code) => ({ code })) },
    ["code", "isAvailableCode", "isShipmentTypeEtgb", "customDeclarationCode", "customDeclarationDate"],
  );
}

export interface CancelledShipment {
  code: string;
  detail: string | null;
  // Format: "YYYY-MM-DD HH:mm:ss" — ASE'nin iptal bilgisini KENDİ sisteminde ne zaman kaydettiği,
  // Ozon'da gerçekte ne zaman iptal edildiği DEĞİL.
  aseCancelRecordedAt: string;
}

// Doküman: "BeginDate ve EndDate arasındaki fark en fazla 1 (bir) ay olabilir." Tarihler
// "YYYY-MM-DD" formatında string olarak veriliyor (Date değil) — çağıran taraf hazırlıyor.
export function getCancelledShipmentsByDateRange(beginDate: string, endDate: string): Promise<CancelledShipment[]> {
  return callAseListEndpoint<CancelledShipment>(
    "/Shipment/GetCancelledShipmentsByDateRange",
    { BeginDate: beginDate, EndDate: endDate },
    ["code", "detail", "aseCancelRecordedAt"],
  );
}

export interface ShipmentMeasurement {
  code: string;
  isAvailableCode: boolean;
  isCancelled: boolean | null;
  isMeasurementCompleted: boolean | null;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

// Bir kerede en fazla 50 kod sorgulanabilir (doküman) — çağıran taraf (statusPolling.ts) bunu
// böler. Doküman ayrıca ölçüm sonuçlarının "kontrol ve onay sürecinden" geçtiğini, bu yüzden
// görünmesinde kısa gecikmeler olabileceğini belirtiyor — yani weightKg uzun süre null kalması
// normal, hata değil.
export function getMeasurementsByCodeList(codes: string[]): Promise<ShipmentMeasurement[]> {
  return callAseListEndpoint<ShipmentMeasurement>(
    "/Shipment/GetMeasurementsByCodeList",
    { CodeList: codes.map((code) => ({ code })) },
    ["code", "isAvailableCode", "isCancelled", "isMeasurementCompleted", "weightKg", "lengthCm", "widthCm", "heightCm"],
  );
}
