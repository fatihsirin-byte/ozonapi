import { parasutGet, parasutPost, parasutPut } from "./client";

export interface ParasutProductAttributes {
  name: string;
  code?: string;
  vat_rate?: number;
  unit?: string;
  list_price?: number;
  currency?: "TRL" | "USD" | "EUR";
}

export interface ParasutProduct {
  id: string;
  type: "products";
  attributes: ParasutProductAttributes;
}

export interface ParasutProductListResponse {
  data: ParasutProduct[];
  meta?: { total_count?: number };
}

export interface ParasutProductResponse {
  data: ParasutProduct;
}

// "code" alanına bizim offerId'mizi yazıyoruz — aynı ürün başka bir faturada tekrar geçtiğinde
// Paraşüt kataloğunda mükerrer ürün açmamak için önce bununla aranıyor (bkz. orderInvoice.ts).
export function searchProductsByCode(code: string) {
  return parasutGet<ParasutProductListResponse>(`products?filter[code]=${encodeURIComponent(code)}`);
}

export function createProduct(attributes: ParasutProductAttributes) {
  return parasutPost<ParasutProductResponse>("products", {
    data: { type: "products", attributes },
  });
}

export function updateProduct(id: string, attributes: Partial<ParasutProductAttributes>) {
  return parasutPut<ParasutProductResponse>(`products/${id}`, {
    data: { id, type: "products", attributes },
  });
}
