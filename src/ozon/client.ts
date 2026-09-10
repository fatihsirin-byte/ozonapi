import axios, { AxiosInstance, AxiosError } from "axios";
import { env } from "../config/env";

export class OzonApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "OzonApiError";
  }
}

function createHttpClient(): AxiosInstance {
  const http = axios.create({
    baseURL: env.ozonBaseUrl,
    timeout: 30_000,
    headers: {
      "Client-Id": env.ozonClientId,
      "Api-Key": env.ozonApiKey,
      "Content-Type": "application/json",
    },
  });

  http.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      let message = error.message ?? "Ozon API request failed";
      const data = error.response?.data;
      // Binary istekler (responseType: "arraybuffer" — bkz. ozonPostBinary/etiket indirme) hata
      // durumunda da gövdeyi döner; ".message" o zaman undefined kalıyor ve gerçek Ozon hata
      // mesajı kayboluyor, kullanıcıya anlamsız "Request failed with status code 400" gösteriliyordu
      // (2026-09-10'da "Etiket Yazdır" 400 hatasında tespit edildi) — burada JSON'a çevirip gerçek
      // mesajı çıkarıyoruz. NOT: Node'da axios "arraybuffer" için gerçekte bir Node Buffer döner,
      // TARAYICI ortamındaki gerçek bir ArrayBuffer DEĞİL — "data instanceof ArrayBuffer" bu yüzden
      // Node'da her zaman false çıkıyordu ve bu düzeltme hiç çalışmıyordu (2026-09-10'da code
      // review'da tespit edildi) — Buffer.isBuffer ile de kontrol ediliyor.
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        try {
          const text = Buffer.isBuffer(data) ? data.toString("utf-8") : Buffer.from(data).toString("utf-8");
          const parsed = JSON.parse(text);
          message = parsed?.message ?? message;
        } catch {
          // gövde JSON değilse generic mesaj kalır
        }
      } else if (data && typeof data === "object" && "message" in (data as Record<string, unknown>)) {
        const rawMessage = (data as Record<string, unknown>).message;
        message = rawMessage != null && rawMessage !== "" ? String(rawMessage) : message;
      }
      throw new OzonApiError(message, error.response?.status, error.response?.data);
    },
  );

  return http;
}

const http = createHttpClient();

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export async function ozonPost<T>(path: string, body?: unknown): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      const response = await http.post<T>(path, body ?? {});
      return response.data;
    } catch (error) {
      attempt += 1;
      const status = error instanceof OzonApiError ? error.status : undefined;
      const shouldRetry = status !== undefined && RETRYABLE_STATUSES.has(status) && attempt < MAX_RETRIES;
      if (!shouldRetry) {
        throw error;
      }
      const backoffMs = 500 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

export async function ozonGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const response = await http.get<T>(path, { params });
  return response.data;
}

// Etiket (PDF) gibi binary dönen endpoint'ler için — Ozon bazen JSON hata (henüz hazır değil vb.)
// döndürebiliyor, o yüzden response Content-Type'a bakılarak ayrıştırılıyor.
export async function ozonPostBinary(path: string, body?: unknown): Promise<Buffer> {
  const response = await http.post(path, body ?? {}, { responseType: "arraybuffer" });
  const contentType = String(response.headers["content-type"] ?? "");
  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(Buffer.from(response.data).toString("utf-8"));
    throw new OzonApiError(parsed?.message ?? "Ozon etiket isteği başarısız", response.status, parsed);
  }
  return Buffer.from(response.data);
}
