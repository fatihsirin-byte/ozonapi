// Gemini'ye toptantr kategori/marka listesinden EN UYGUN olanı seçtirir. Binlerce kategori/markayı
// olduğu gibi göndermek yerine önce ucuz bir anahtar-kelime ön-filtresiyle daralt (VPS'teki
// orijinal projedeki geminiClient.js'in birebir aynısı — "Orta" (Orta Boy) kelimesinin "Kaporta"
// içinde eşleşmesi gibi bir yanlış sınıflandırmayı önlemek için TAM KELİME eşleşmesi kullanılıyor).
import { extractFirstJsonObject } from "../ai/json-extract";
import type { ToptantrCategory, ToptantrBrand } from "./client";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function tokenize(str: string): string[] {
  return (str.toLowerCase().match(/[a-zçğıöşü0-9]+/gi) ?? []).filter((w) => w.length > 2);
}

function topCandidatesByNameSimilarity<T>(
  query: string,
  items: T[],
  nameOf: (item: T) => string,
  { limit = 60, minMatches = 5 } = {},
): T[] {
  const qTokens = new Set(tokenize(query));
  const scored = items.map((item) => {
    const nameTokens = tokenize(nameOf(item));
    let score = 0;
    for (const token of nameTokens) if (qTokens.has(token)) score += 1;
    return { item, score };
  });
  const withMatches = scored.filter((s) => s.score > 0);
  if (withMatches.length < minMatches) return items;
  withMatches.sort((a, b) => b.score - a.score);
  return withMatches.slice(0, limit).map((s) => s.item);
}

export interface CategoryBrandMatch {
  categoryGuid: string | null;
  brandGuid: string | null;
}

// title ÇEVİRİLMİŞ (Türkçe) başlık olmalı — toptantr kategori breadcrumb'ları Türkçe, orijinal
// İngilizce başlıkla eşleştirmeye çalışmak neredeyse hiç örtüşme vermezdi.
export async function matchCategoryAndBrand(params: {
  title: string;
  productType: string | null;
  vendor: string | null;
  categories: ToptantrCategory[];
  brands: ToptantrBrand[];
}): Promise<CategoryBrandMatch> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY tanımlı değil");

  const candidateCategories = topCandidatesByNameSimilarity(params.title, params.categories, (c) => c.breadcrumb ?? c.name ?? "");
  const candidateBrands = topCandidatesByNameSimilarity(params.vendor ?? "", params.brands, (b) => b.name, {
    limit: 20,
    minMatches: 2,
  });

  const prompt = `Aşağıda bir ürün bilgisi ve toptantr pazaryerinde satıcıya izin verilmiş
kategori/marka listesinden bir alt küme var. Bu ürün için EN UYGUN kategori ve
markayı seç. Sadece verilen listeler içinden seç, uydurma guid üretme.
Uygun marka bulamazsan brandGuid'i null bırak.

SADECE şu JSON formatında cevap ver: {"categoryGuid": "...", "brandGuid": "..." | null}

Ürün başlığı: ${params.title}
Ürün tipi: ${params.productType || "(belirtilmemiş)"}
Marka (Shopify vendor): ${params.vendor || "(belirtilmemiş)"}

Kategori adayları:
${candidateCategories.map((c) => `- guid=${c.guid} :: ${c.breadcrumb || c.name}`).join("\n")}

Marka adayları:
${candidateBrands.map((b) => `- guid=${b.guid} :: ${b.name}`).join("\n")}`;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API hatası (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini boş cevap döndü");

  const parsed = JSON.parse(extractFirstJsonObject(text)) as { categoryGuid?: string; brandGuid?: string | null };
  const categoryGuid = candidateCategories.some((c) => c.guid === parsed.categoryGuid) ? parsed.categoryGuid! : null;
  const brandGuid = candidateBrands.some((b) => b.guid === parsed.brandGuid) ? parsed.brandGuid ?? null : null;
  return { categoryGuid, brandGuid };
}
