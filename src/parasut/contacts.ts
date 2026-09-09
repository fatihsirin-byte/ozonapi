import { parasutGet, parasutPost } from "./client";

export interface ParasutContactAttributes {
  name: string;
  short_name?: string;
  contact_type?: "person" | "company";
  tax_number?: string;
  tax_office?: string;
  city?: string;
  district?: string;
  address?: string;
  email?: string;
  phone?: string;
  account_type?: "customer" | "supplier"; // faturayı kime kesiyorsak "customer"
}

export interface ParasutContact {
  id: string;
  type: "contacts";
  attributes: ParasutContactAttributes;
}

export interface ParasutContactListResponse {
  data: ParasutContact[];
  meta?: { total_count?: number };
}

export interface ParasutContactResponse {
  data: ParasutContact;
}

export function listContacts(page = 1, size = 25) {
  return parasutGet<ParasutContactListResponse>(`contacts?page[number]=${page}&page[size]=${size}`);
}

// Vergi numarasına göre mevcut bir kontak (müşteri/tedarikçi) arar — fatura kesmeden önce
// aynı kontağın tekrar tekrar oluşturulmaması için kullanılır.
export function searchContactsByTaxNumber(taxNumber: string) {
  return parasutGet<ParasutContactListResponse>(`contacts?filter[tax_number]=${encodeURIComponent(taxNumber)}`);
}

export function createContact(attributes: ParasutContactAttributes) {
  return parasutPost<ParasutContactResponse>("contacts", {
    data: { type: "contacts", attributes },
  });
}
