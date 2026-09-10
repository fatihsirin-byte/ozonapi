import axios, { AxiosInstance, AxiosError } from "axios";
import { env } from "../config/env";

export class ParasutApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ParasutApiError";
  }
}

function requireParasutConfig() {
  const missing = (
    [
      ["PARASUT_CLIENT_ID", env.parasutClientId],
      ["PARASUT_CLIENT_SECRET", env.parasutClientSecret],
      ["PARASUT_USERNAME", env.parasutUsername],
      ["PARASUT_PASSWORD", env.parasutPassword],
      ["PARASUT_COMPANY_ID", env.parasutCompanyId],
    ] as const
  ).filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new ParasutApiError(
      `Paraşüt entegrasyonu için eksik .env değişkenleri: ${missing.map(([name]) => name).join(", ")}`,
      undefined,
      null,
    );
  }

  return {
    clientId: env.parasutClientId!,
    clientSecret: env.parasutClientSecret!,
    username: env.parasutUsername!,
    password: env.parasutPassword!,
    companyId: env.parasutCompanyId!,
  };
}

interface ParasutTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  created_at: number;
}

// Basit bellek-içi token önbelleği — Ozon client'ındaki pattern gibi tek process içinde
// paylaşılıyor (bkz. src/ozon/client.ts). Süresi dolmadan (60sn güvenlik payı) tekrar
// kullanılıyor, dolunca password grant ile yeniden alınıyor (refresh_token akışı henüz
// eklenmedi — kalıcı depolama gerektirir, ilk sürüm için gereksiz karmaşıklık).
let cachedToken: { accessToken: string; expiresAt: number } | null = null;
let inFlightTokenRequest: Promise<string> | null = null;

async function fetchAccessToken(): Promise<string> {
  const config = requireParasutConfig();

  const response = await axios.post<ParasutTokenResponse>(
    `${env.parasutBaseUrl}/oauth/token`,
    {
      grant_type: "password",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      username: config.username,
      password: config.password,
      redirect_uri: env.parasutRedirectUri,
    },
    { headers: { "Content-Type": "application/json" } },
  );

  const data = response.data;
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.accessToken;
}

// ParasutInvoiceButton her sipariş satırı için ayrı ayrı 10 saniyede bir durum kontrolü yapıyor
// (bkz. app/orders/ParasutInvoiceButton.tsx) — token süresi dolduğunda/boşken bunların hepsi AYNI
// ANDA burayı çağırabiliyordu, her biri kendi fetchAccessToken() isteğini Paraşüt'e eşzamanlı
// gönderiyordu. Bu, 2026-09-10'da canlıda çok sayıda sipariş faturalanmışken butonların sonsuza
// dek "İşleniyor"da takılı kalmasıyla tespit edildi — eşzamanlı password-grant isteklerinin bir
// kısmı sessizce başarısız oluyordu (hata örtük yutulduğu için loglarda görünmüyordu, bkz.
// eArchives.ts). Çözüm: aynı anda TEK bir token isteği uçuşta olsun, geri kalan çağıranlar onu
// beklesin ("single-flight").
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }
  if (!inFlightTokenRequest) {
    inFlightTokenRequest = fetchAccessToken().finally(() => {
      inFlightTokenRequest = null;
    });
  }
  return inFlightTokenRequest;
}

function createHttpClient(): AxiosInstance {
  const http = axios.create({
    baseURL: `${env.parasutBaseUrl}/v4`,
    timeout: 30_000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  http.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      const data = error.response?.data as { errors?: Array<{ title?: string; detail?: string }>; error_description?: string } | undefined;
      const message =
        data?.errors?.[0]?.detail ?? data?.errors?.[0]?.title ?? data?.error_description ?? error.message ?? "Paraşüt API isteği başarısız";
      throw new ParasutApiError(message, error.response?.status, error.response?.data);
    },
  );

  return http;
}

const http = createHttpClient();

const MAX_RETRIES = 3;

// path, company_id'siz gönderilir — örn. "sales_invoices", "contacts/123" — burada otomatik
// /v4/{company_id}/ öneki eklenir (bkz. Paraşüt'ün PHP resmi olmayan client'ındaki aynı pattern).
// 429 (rate limit) durumunda Ozon client'ındaki gibi (bkz. src/ozon/client.ts) üstel bekleme ile
// tekrar deniyor — sıra numarası bulmak için onlarca sayfa taranırken (bkz. orderInvoice.ts)
// bu limite gerçekten takılıyor (2026-09-09'da canlıda tespit edildi).
async function parasutRequest<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const config = requireParasutConfig();
  let attempt = 0;
  while (true) {
    try {
      const token = await getAccessToken();
      const response = await http.request<T>({
        method,
        url: `/${config.companyId}/${path}`,
        data: body,
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (error) {
      attempt += 1;
      const status = error instanceof ParasutApiError ? error.status : undefined;
      const shouldRetry = status === 429 && attempt < MAX_RETRIES;
      if (!shouldRetry) throw error;
      const backoffMs = 1500 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

export function parasutGet<T>(path: string): Promise<T> {
  return parasutRequest<T>("GET", path);
}

export function parasutPost<T>(path: string, body: unknown): Promise<T> {
  return parasutRequest<T>("POST", path, body);
}

export function parasutPut<T>(path: string, body: unknown): Promise<T> {
  return parasutRequest<T>("PUT", path, body);
}

export function parasutDelete<T>(path: string): Promise<T> {
  return parasutRequest<T>("DELETE", path);
}
