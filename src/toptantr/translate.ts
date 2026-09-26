// Shopify başlık/açıklamasını Türkçe'ye çevirir — toptantr kategori ağacı Türkçe olduğundan
// kategori eşleştirmesi de bu çeviriye göre yapılıyor (bkz. categoryMatch.ts). VPS'teki orijinal
// projedeki geminiClient.js'in aynısı, src/ai/translate.ts'teki ("Ozon'a Rusça") pattern'e
// uyacak şekilde (SDK yerine düz REST çağrısı) taşındı.
import { extractFirstJsonObject } from "../ai/json-extract";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Cümle sınırında kes (yoksa kelime sınırında) — düz .slice() "...400 gramlık bu pa" gibi
// kelimenin ortasından kesiyordu (VPS'teki orijinal bug, aynı düzeltme burada da geçerli).
function smartTruncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text ?? "";
  const cut = text.slice(0, maxLength);
  const lastSentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastSentenceEnd > maxLength * 0.5) return cut.slice(0, lastSentenceEnd + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

export interface ToptantrTranslation {
  title: string;
  shortDescription: string;
  fullDescription: string;
}

export async function translateForToptantr(title: string, bodyHtml: string): Promise<ToptantrTranslation> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY tanımlı değil");

  const description = stripHtml(bodyHtml).slice(0, 3000);
  const prompt = `Sen bir e-ticaret ürün metni çevirmenisin. Aşağıdaki İngilizce ürün bilgisini
Türkçeye çevir ve SADECE şu JSON formatında cevap ver, başka hiçbir açıklama ekleme:
{"title": "...", "shortDescription": "...", "fullDescription": "..."}

Kurallar:
- title: doğal, akıcı bir Türkçe ürün başlığı (ürün ismini birebir değil, anlaşılır şekilde çevir)
- shortDescription: KESİNLİKLE en fazla 480 karakter (boşluklar dahil), düz metin, ürünün kısa özeti.
  Bu sınırı asla aşma — sınıra yaklaşıyorsan cümleyi kısalt, tam bir cümleyle bitir, yarım bırakma.
- fullDescription: KESİNLİKLE en fazla 3900 karakter (boşluklar dahil), HTML olabilir (<p>, <ul>,
  <li>, <strong> etiketleri), ürünün detaylı açıklaması. Bu sınırı asla aşma, HTML etiketlerini
  yarım bırakma (her açılan etiket kapatılmalı).

İngilizce ürün başlığı: ${title}
İngilizce ürün açıklaması (HTML olabilir): ${description || "(açıklama yok)"}`;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API hatası (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini boş cevap döndü");

  const parsed = JSON.parse(extractFirstJsonObject(text)) as Partial<ToptantrTranslation>;
  return {
    title: smartTruncate(parsed.title || title, 400),
    shortDescription: smartTruncate(parsed.shortDescription || "", 500),
    fullDescription: smartTruncate(parsed.fullDescription || "", 4000),
  };
}
