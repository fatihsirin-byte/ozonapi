import axios, { AxiosInstance } from "axios";
import { env } from "../config/env";

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

function requireConfig(): { domain: string; token: string } {
  if (!env.shopifyStoreDomain || !env.shopifyAdminApiToken) {
    throw new Error(
      "Shopify entegrasyonu yapılandırılmamış: SHOPIFY_STORE_DOMAIN ve SHOPIFY_ADMIN_API_TOKEN gerekli",
    );
  }
  return { domain: env.shopifyStoreDomain, token: env.shopifyAdminApiToken };
}

let http: AxiosInstance | null = null;

function getHttp(): AxiosInstance {
  if (http) return http;
  const { domain, token } = requireConfig();
  http = axios.create({
    baseURL: `https://${domain}.myshopify.com/admin/api/${env.shopifyApiVersion}`,
    timeout: 30_000,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
  return http;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export async function shopifyGraphQl<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const client = getHttp();
  const response = await client.post<GraphQlResponse<T>>("/graphql.json", { query, variables });
  if (response.data.errors?.length) {
    throw new ShopifyApiError(response.data.errors.map((e) => e.message).join("; "), response.status, response.data);
  }
  if (!response.data.data) {
    throw new ShopifyApiError("Shopify GraphQL boş yanıt döndürdü", response.status, response.data);
  }
  return response.data.data;
}
