// Shopify başlık/açıklamasını Türkçe'ye çevirir — toptantr kategori ağacı Türkçe olduğundan
// kategori eşleştirmesi de bu çeviriye göre yapılıyor (bkz. categoryMatch.ts). VPS'teki orijinal
// projedeki geminiClient.js'in aynısı, src/ai/translate.ts'teki ("Ozon'a Rusça") pattern'e
// uyacak şekilde (SDK yerine düz REST çağrısı) taşındı.
import { extractFirstJsonObject } from "../ai/json-extract";

// 2.5 yerine 3.5 (kullanıcı kararı, 2026-10-09) — canlı anahtarda erişim doğrulandı; GEMINI_MODEL ile değiştirilebilir.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
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
  const prompt = `Sen Türkiye'de toptan gıda/kozmetik satan bir B2B pazaryerinde (toptantr) çalışan deneyimli bir ürün metin yazarısın.
Aşağıdaki İngilizce ürün bilgisinden, Türk esnafına/alıcısına yönelik ÖZGÜN bir Türkçe ürün sayfası metni YAZ.
Bu bir çeviri işi değil, yeniden yazım: İngilizce cümle yapısını, kalıplarını ve pazarlama klişelerini ("premium quality",
"experience the...", "perfect for...") Türkçeye kelime kelime taşıma. Türkçede bir ürün sayfası nasıl yazılırsa öyle yaz.

SADECE şu JSON formatında cevap ver, başka hiçbir şey ekleme:
{"title": "...", "shortDescription": "...", "fullDescription": "..."}

Üslup kuralları:
- Doğal, sıcak ama ölçülü, bilgilendirici bir dil. Robotik/çeviri kokan cümleler, abartılı sıfat yığınları ve
  "eşsiz, mükemmel, benzersiz deneyim" gibi boş klişeler YOK. Her cümle bir bilgi taşısın.
- title: Türkçe e-ticaret başlık düzeninde: Marka + ürün adı + çeşit/aroma + gramaj/adet. İngilizce sıfat sırasını
  taklit etme. Marka adlarını ve gramaj/ölçüyü (g, kg, ml) aynen koru. Anahtar kelime doldurma yapma.
  Örn. "Professional Sweet Smoked Paprika Powder - 1 kg" -> "Profesyonel Tatlı Füme Toz Biber (Paprika) 1 kg".
- shortDescription: KESİNLİKLE en fazla 480 karakter, düz metin, 2-3 doğal cümle: ürün ne, kime/neye uygun, öne çıkan 1-2 özellik.
  Tam bir cümleyle bitir, yarım bırakma.
- fullDescription: KESİNLİKLE en fazla 3900 karakter, HTML (<p>, <ul>, <li>, <strong>). Kısa paragraflar + gerekiyorsa
  madde işaretli özellik listesi. Kullanım önerisi, içerik/menşe/ambalaj bilgisi kaynak metinde VARSA ekle.
  Kaynakta olmayan hiçbir bilgiyi (sertifika, içerik, sağlık iddiası, menşe, raf ömrü, adet) UYDURMA.
  Her açılan HTML etiketi kapatılmalı.
- Türkçe karakterleri ve imlayı doğru kullan, büyük harfle yazılmış başlık yapma.

İngilizce ürün başlığı: ${title}
İngilizce ürün açıklaması (HTML olabilir): ${description || "(açıklama yok)"}`;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.6 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API hatası (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = (data.candidates?.[0]?.content?.parts ?? []) as { text?: string; thought?: boolean }[];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  if (!text) throw new Error("Gemini boş cevap döndü");

  const parsed = JSON.parse(extractFirstJsonObject(text)) as Partial<ToptantrTranslation>;
  return {
    title: smartTruncate(parsed.title || title, 400),
    shortDescription: smartTruncate(parsed.shortDescription || "", 500),
    fullDescription: smartTruncate(parsed.fullDescription || "", 4000),
  };
}
