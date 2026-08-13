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

// Gemini prompt'ta emoji kullanmaması istense de bazen kaçıyor — Ozon'da emoji içeren
// açıklamalar moderasyonda sorun çıkarabiliyor, ek güvence olarak burada da temizliyoruz.
function stripEmoji(text: string): string {
  return text
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

// Marka/model adı Latin bırakılırken bazen Türkçe özel karakterler (ğ, ş, ı, ö, ü, ç) de
// olduğu gibi kalıyor (örn. "Arifoğlu") — Rusça bir pazaryerinde bu karakterler yanlış
// render olabiliyor/tutarsız görünüyor. Prompt'ta kural olarak istense de kaçabiliyor,
// emoji gibi ek bir güvence olarak burada da düz Latin'e çeviriyoruz (2026-08-05).
const TURKISH_CHAR_MAP: Record<string, string> = {
  ğ: "g", Ğ: "G", ş: "s", Ş: "S", ı: "i", İ: "I", ö: "o", Ö: "O", ü: "u", Ü: "U", ç: "c", Ç: "C",
};
function stripTurkishChars(text: string): string {
  return text.replace(/[ğĞşŞıİöÖüÜçÇ]/g, (ch) => TURKISH_CHAR_MAP[ch] ?? ch);
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
   kalarak çevir, farklı bir ürün türüne dönüştürme.
6. EMOJİ KULLANMA: nameRu ve descriptionRu içinde hiçbir emoji, sembol ikon (✨🔥💧⭐ vb.)
   veya özel dekoratif karakter olmayacak — sadece düz metin. Bu bir pazaryeri ürün kartı,
   sosyal medya gönderisi değil.
7. AĞIRLIK/ADET TEKRARINI TEMİZLE: Shopify başlıkları genelde varyant bilgisini (gram, adet,
   "X Pieces", "X Box", "X pcs each") başlığın İÇİNE gömülü, bazen AYNI bilgiyi birden fazla
   parantez içinde tekrar tekrar yazar (örn. "37gr (6pcs) - 10 Box (6pcs x 37gr Each Box)").
   Bu bilgi zaten Ozon'da ayrı yapısal alanlarda (Ürün ağırlığı, Birimler tek bir üründe)
   gösteriliyor — başlıkta tekrar tekrar yazılması sipariş görünümünde saçma/karmaşık
   duruyor. nameRu'da gram/adet bilgisini EN FAZLA BİR KERE, kısa ve sade şekilde geçir
   (örn. sadece toplam adet VEYA sadece tekil ağırlık, ikisi birden gerekmiyorsa); aynı
   sayıyı birden fazla parantez/tekrar içinde farklı şekillerde yeniden yazma.
8. TÜRKÇE ÖZEL KARAKTER KULLANMA: Latin bırakılan marka/model adlarında bile (ğ, ş, ı, ö, ü, ç,
   Ğ, Ş, İ, Ö, Ü, Ç) harflerini KULLANMA — düz Latin karşılığını yaz (örn. "Arifoğlu" değil
   "Arifoglu", "Beşiktaş" değil "Besiktas"). Bu Rusça bir pazaryeri, Türkçe özel karakterler
   yanlış görünebiliyor/tutarsız render oluyor.${vendorRule}

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
  return {
    nameRu: stripTurkishChars(stripEmoji(parsed.nameRu)),
    descriptionRu: stripTurkishChars(stripEmoji(parsed.descriptionRu)),
  };
}

// Ozon'un kendi aksiyon/kampanya başlıkları Rusça geliyor (bkz. src/ozon/actions.ts) — kampanya
// sayfasında okunur olması için Türkçe'ye çeviriyoruz. Process-ömürlü basit bir cache var çünkü
// aksiyon sayısı azdır (birkaç tane) ve başlıkları neredeyse hiç değişmez — her sayfa
// yüklemesinde aynı metni tekrar tekrar Gemini'ye göndermeye gerek yok (2026-08-14).
const titleTranslationCache = new Map<string, string>();

export async function translateActionTitle(title: string): Promise<string> {
  const cached = titleTranslationCache.get(title);
  if (cached) return cached;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return title; // çeviremiyorsak orijinali göster, sayfayı bozmasın

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Aşağıdaki Ozon pazaryeri kampanya/promosyon başlığını Rusça'dan Türkçe'ye çevir. SADECE çevrilmiş metni yaz, başka hiçbir şey ekleme (tırnak, açıklama vb. yok):\n\n${title}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      }),
    });
    if (!res.ok) return title;
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return title;
    // NOT: stripTurkishChars burada KULLANILMIYOR — hedef dil Türkçe, ğ/ş/ı gibi karakterler
    // istenen, aksine korunmalı (o fonksiyon sadece Rusça çıktı için Latin marka adlarını temizliyordu).
    titleTranslationCache.set(title, text);
    return text;
  } catch {
    return title; // çeviri başarısız olsa da kampanya listesi çalışmaya devam etsin
  }
}
