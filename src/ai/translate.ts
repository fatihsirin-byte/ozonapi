// Shopify başlık/açıklamasını Rusça'ya çevirir — Ozon kartlarında Rusça göstermek için.
// Ucuz/hızlı bir model kullanıyoruz (attribute önerisi gibi tekrarlı/pahalı bir kullanım değil,
// ürün başına tek seferlik ve sonuç cache'lendiği için model seçimi maliyeti düşük tutuyor).
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface TranslationResult {
  nameRu: string;
  descriptionRu: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function translateToRussian(title: string, descriptionHtml: string): Promise<TranslationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY tanımlı değil");
  }

  const description = stripHtml(descriptionHtml).slice(0, 3000);
  const prompt = `Aşağıdaki ürün başlığını ve açıklamasını Rusça'ya çevir. Sadece şu JSON formatında cevap ver, başka hiçbir şey yazma: {"nameRu": "...", "descriptionRu": "..."}\n\nBaşlık: ${title}\n\nAçıklama: ${description}`;

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
  if (!text) {
    throw new Error("Gemini boş cevap döndü");
  }

  const parsed = JSON.parse(text) as TranslationResult;
  if (!parsed.nameRu || !parsed.descriptionRu) {
    throw new Error("Gemini beklenen alanları döndürmedi");
  }
  return parsed;
}
