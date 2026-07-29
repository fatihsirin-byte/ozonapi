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
      const message =
        (error.response?.data as any)?.message ?? error.message ?? "Ozon API request failed";
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
