import http from "http";
import https from "https";
import { env } from "../config/env";

export class ToptantrApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ToptantrApiError";
  }
}

function assertCredentials(): { username: string; password: string } {
  if (!env.toptantrUsername || !env.toptantrPassword) {
    throw new Error("TOPTANTR_USERNAME / TOPTANTR_PASSWORD tanımlı değil (.env) — dry-run dışında her çağrı için gerekli");
  }
  return { username: env.toptantrUsername, password: env.toptantrPassword };
}

interface CachedToken {
  access_token: string;
  expires_at_utc: string;
}

let cachedToken: CachedToken | null = null;

function isTokenValid(): boolean {
  if (!cachedToken) return false;
  return new Date(cachedToken.expires_at_utc).getTime() > Date.now() + 60_000;
}

async function getToken(): Promise<string> {
  const { username, password } = assertCredentials();
  if (isTokenValid()) return cachedToken!.access_token;

  const response = await fetch(`${env.toptantrBaseUrl}/sapi/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = (await response.json()) as Partial<CachedToken> & Record<string, unknown>;
  if (!response.ok || !data.access_token) {
    throw new ToptantrApiError(`toptantr token isteği başarısız: ${JSON.stringify(data)}`, response.status, data);
  }
  cachedToken = data as CachedToken;
  return cachedToken.access_token;
}

async function apiRequest<T = unknown>(method: string, endpoint: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const response = await fetch(`${env.toptantrBaseUrl}${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || data.Success === false || data.success === false) {
    throw new ToptantrApiError(
      `toptantr ${method} ${endpoint} başarısız: ${(data.msg as string) ?? response.statusText}`,
      response.status,
      data,
    );
  }
  return data as T;
}

// "Ürünler" arama ucu [HTTPGET] olarak belgeli ama JSON body bekliyor (sipariş/sevkiyat gibi
// POST alternatifi yok) — fetch() GET isteğinde body göndermeyi reddettiği için burada ham
// http/https modülüyle gönderiliyor (VPS'teki orijinal toptantrClient.js'teki aynı çözüm).
function getWithBody<T = unknown>(endpoint: string, body: unknown): Promise<T> {
  return getToken().then(
    (token) =>
      new Promise<T>((resolve, reject) => {
        const url = new URL(`${env.toptantrBaseUrl}${endpoint}`);
        const transport = url.protocol === "https:" ? https : http;
        const payload = JSON.stringify(body);
        const req = transport.request(
          url,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
              Authorization: `Bearer ${token}`,
            },
          },
          (res) => {
            let raw = "";
            res.on("data", (chunk) => (raw += chunk));
            res.on("end", () => {
              let data: Record<string, unknown> = {};
              try {
                data = JSON.parse(raw);
              } catch {
                // gövde JSON değilse boş obje kalır
              }
              if ((res.statusCode ?? 0) >= 400 || data.Success === false || data.success === false) {
                reject(new ToptantrApiError(`toptantr GET ${endpoint} başarısız: ${(data.msg as string) ?? res.statusMessage}`, res.statusCode, data));
                return;
              }
              resolve(data as T);
            });
          },
        );
        req.on("error", reject);
        req.write(payload);
        req.end();
      }),
  );
}

// Bu uçlar page/size parametresi kabul ediyor ama gerçek sayfalama meta verisi (totalPages vb.)
// hiç dönmüyor — "bir sonraki sayfa DAHA AZ öğe döndürene kadar" devam etmek tek güvenilir sinyal
// (VPS'teki orijinal projede 4822 markalık liste bu yüzden ilk sayfada -300 öğe- sessizce
// kesiliyordu, bkz. o projedeki fetchAllPages yorumu).
async function fetchAllPages<T>(endpoint: string, itemsKey: "categories" | "brands", pageSize = 300): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const data = await apiRequest<Record<string, T[]>>("GET", `${endpoint}?page=${page}&size=${pageSize}`);
    const pageItems = data[itemsKey] ?? data.content ?? [];
    items.push(...(pageItems as T[]));
    if (pageItems.length < pageSize) break;
    page += 1;
  }
  return items;
}

export interface ToptantrCategory {
  guid: string;
  breadcrumb?: string;
  name?: string;
}

export interface ToptantrBrand {
  guid: string;
  name: string;
}

export async function fetchCategories(): Promise<ToptantrCategory[]> {
  return fetchAllPages<ToptantrCategory>("/sapi/v1/categories", "categories");
}

export async function fetchBrands(): Promise<ToptantrBrand[]> {
  return fetchAllPages<ToptantrBrand>("/sapi/v1/brands", "brands");
}

export interface ToptantrCombinationInput {
  barcode: string;
  itemPerPackage: number;
  purchaseableLimit: number;
  attributes: { id: number; name: string }[];
}

export interface ToptantrProductPayload {
  title: string;
  shortDescription: string;
  fullDescription: string;
  barcode: string;
  categories: { guid: string }[];
  brands: { guid: string }[];
  taxCategory: number;
  isTaxExempt: boolean;
  productCost: number;
  weight: number;
  length: number;
  width: number;
  height: number;
  images: { url: string }[];
  productSpecificationOptions: unknown[];
  productAttributeCombinations: ToptantrCombinationInput[];
}

export async function createProduct(payload: ToptantrProductPayload): Promise<{ id?: string } & Record<string, unknown>> {
  return apiRequest("POST", "/sapi/v1/products/new", { product: payload });
}

export async function updateProduct(id: string, payload: Partial<ToptantrProductPayload>) {
  return apiRequest("PUT", "/sapi/v1/products", { product: { id, ...payload } });
}

export interface ToptantrFoundCombination {
  id: string;
  attributes?: { id: number; name: string }[];
}

export interface ToptantrFoundProduct {
  id: string;
  productCode?: string;
  productAttributeCombinations?: ToptantrFoundCombination[];
}

export async function findProductByBarcode(barcode: string): Promise<ToptantrFoundProduct | null> {
  const data = await getWithBody<{ content?: ToptantrFoundProduct[] }>("/sapi/v1/products", {
    productSearch: { barcode, page: 1, size: 10 },
  });
  return data.content?.[0] ?? null;
}

// createProduct'taki ToptantrCombinationInput (barcode/itemPerPackage/attributes) ile KARIŞTIRMA:
// bu farklı bir uç — mevcut bir ürünün stok/fiyatını günceller, toptantr'ın kendi atadığı
// kombinasyon `id`'siyle (barkod DEĞİL) — bkz. findProductByBarcode'un döndürdüğü
// productAttributeCombinations[].id (2026-09-26'da VPS'teki gerçek pipeline.js'ten doğrulandı).
export interface ToptantrCombinationStockUpdate {
  id: string;
  quantity: number;
  taxCategory: number;
  sellingPrice: number;
}

export async function updateCombinations(combinations: ToptantrCombinationStockUpdate[]) {
  return apiRequest("PUT", "/sapi/v1/combinations", { product: { combinations } });
}
