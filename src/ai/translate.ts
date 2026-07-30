// Shopify başlık/açıklamasını Rusça'ya çevirir — Ozon kartlarında Rusça göstermek için.
// Ucuz/hızlı bir model kullanıyoruz (attribute önerisi gibi tekrarlı/pahalı bir kullanım değil,
// ürün başına tek seferlik ve sonuç cache'lendiği için model seçimi maliyeti düşük tutuyor).
import { extractFirstJsonObject } from "./json-extract";

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface TranslationResult {
  nameRu: string;
  descriptionRu: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function translateToRussian(
  title: string,
  descriptionHtml: string,
  vendor?: string | null,
): Promise<TranslationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY tanımlı değil");
  }

  const description = stripHtml(descriptionHtml).slice(0, 3000);
  const vendorLine = vendor
    ? `\n\nTedarikçi/marka adı (ayrı bir alandan geliyor): ${vendor}`
    : "";
  const vendorRule = vendor
    ? `\n7. MARKA BAŞLIKTA YOKSA EKLE: Yukarıda verilen "${vendor}" marka adı başlığın metninde zaten
   geçmiyorsa, çevrilen başlığın (nameRu) başına Latin harfleriyle ekle (örn. "${vendor} Электрическая турка...").
   Zaten geçiyorsa tekrar ekleme.`
    : "";

  const prompt = `Aşağıdaki ürün başlığını ve açıklamasını Rusça'ya çevir.

ÖZEL KURAL — SADECE MARKA VE MODEL ADI LATİN ALFABESİYLE KALACAK, GERİ KALAN HER KELİME
RUSÇA'YA ÇEVRİLECEK (İngilizce başlıkta olsa bile):
Latin bırakılacak SADECE şunlardır: (a) üreticinin/tedarikçinin marka adı (şirket adı),
(b) varsa alfasayısal model kodu/seri adı (örn. "MINIO", "XY-200", "Pro Max"). BUNLARIN
DIŞINDA KALAN HER KELİME — ürün tipi, malzeme, renk, boyut, kullanım amacı gibi TÜM
açıklayıcı kelimeler — Rusça'ya çevrilir, İngilizce başlıkta Title Case (Büyük Harfle
Başlayan) yazılmış olması onları marka yapmaz.

ÖRNEK (doğru davranış):
Başlık: "ARZUM OKKA Turka Electric MINIO, copper, black"
Doğru nameRu: "ARZUM OKKA MINIO Электрическая турка, медная, черная"
(bunda YANLIŞ olan: "Turka Electric", "copper", "black" kelimelerini Latin bırakmak —
bunlar marka/model değil, hepsi Rusça'ya çevrilmeli. Sadece "ARZUM OKKA" (marka) ve
"MINIO" (model) Latin kaldı, YAN YANA yazıldı.)

Hangi kelimenin gerçekten marka/model olduğuna karar verirken şu ayrımı kullan:
1. Marka/model: şirket adı, ürün serisi adı, model kodu/numarası — SADECE bunlar.
2. Marka/model DEĞİL (mutlaka Rusça'ya çevir): ürünün tipi/kategorisi, malzemesi, rengi,
   boyutu, kullanım amacı gibi TÜM jenerik/açıklayıcı kelimeler — İngilizce başlıkta
   büyük harfle başlasalar bile bunlar marka değildir (örn. "Chocolate Bar", "Cotton
   Towel Set", "Sterling Silver", "Turka Electric", "Copper", "Black" hepsi çevrilir).
3. Emin olamadığın sınır durumlarda varsayılan: ÇEVİR. Latin bırakmak istisnadır, kural
   değil — sadece gerçekten şirket/model adı gibi duruyorsa Latin bırak.
4. Marka adı VE model kodu ikisi de Latin bırakılıyorsa, çevrilen metinde bu ikisini
   YAN YANA (aralarına Rusça kelime girmeden) yaz.
5. Ürün TÜRÜNÜ (kolye/yüzük, havlu/çarşaf, kap/cihaz vb.) başlıktaki kelimeye sadık
   kalarak çevir, farklı bir ürün türüne dönüştürme.${vendorRule}

Sadece şu JSON formatında cevap ver, başka hiçbir şey yazma: {"nameRu": "...", "descriptionRu": "..."}

Başlık: ${title}${vendorLine}

Açıklama: ${description}`;

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

  const parsed = JSON.parse(extractFirstJsonObject(text)) as TranslationResult;
  if (!parsed.nameRu || !parsed.descriptionRu) {
    throw new Error("Gemini beklenen alanları döndürmedi");
  }
  return parsed;
}
