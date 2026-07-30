// Ozon infografik görseli için Canva'da kullanılacak başlık + 2 slogan üretir (Rusça).
// Prompt kullanıcıdan (reklam metni yazarı) geldi — kurallar kasıtlı katı: sadece somut/
// duyusal USP'ler, marka/model tekrarı yok, uydurma teknik iddia yok.
import { extractFirstJsonObject } from "./json-extract";

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface SloganSet {
  title: string;
  slogan1: string;
  slogan2: string;
}

const PROMPT_TEMPLATE = `Sen Ozon (Rusya pazaryeri) için ürün infografik görseli metni yazan bir reklam metni
yazarısın. Sana bir ürün adı vereceğim. Görevin, bu ürünün görseline eklenecek üç kısa
metin üretmek: 1 ana başlık + 2 kısa slogan (USP).

KESİN KURALLAR (bunlara uymazsan çıktı kullanılamaz hale gelir):
1. SADECE Rusça çıktı ver. Başka dilde TEK KELİME BİLE olmasın — taş/malzeme/renk adları
   dahil (örn. "ZIRCON" değil "ЦИРКОН" yaz, "SILVER" değil "СЕРЕБРО" yaz). Latin
   harfli tek bir kelime bile çıktıyı geçersiz kılar.
2. Ana başlık en fazla 3-4 kelime, TÜMÜ BÜYÜK HARF. Ürünün kategorisini/temel faydasını
   anlatan genel bir çekiş cümlesi olsun. Marka/model adını TEKRARLAMA, o zaten ayrı
   gösteriliyor.
3. İki slogan da en fazla 3-4 kelime, ilk harfi büyük diğerleri küçük (başlık gibi TÜMÜ
   BÜYÜK HARF OLMASIN). İkisi de SOMUT/DUYUSAL bir özellik ya da kullanım faydası
   anlatsın (dokusu, malzemesi, nasıl kullanıldığı, ne işe yaradığı gibi). "İnanılmaz
   tat", "muhteşem deneyim", "eşsiz kalite" gibi SOYUT/DUYGUSAL sıfat cümleleri YAZMA —
   ikisi de aynı derecede somut olmalı, biri somut biri soyut olmasın.
4. UZUN METİN YAZMA — bunlar bir görselin üzerine bindirilecek, ekranda 2 satırdan uzun
   duramaz. Her slogan tek satıra sığacak kısalıkta olmalı.
5. GÜVENİLİRLİK KURALI — asla icat etme: Sadece ürün adından/kategorisinden AÇIKÇA VE
   GENEL OLARAK bilinen, o kategori için tipik/beklenen/tanımlayıcı özellikleri yaz.
   Ürüne özel sayısal/teknik bir iddiada (güç, süre, garanti yılı, kapasite sayısı vb.)
   BULUNMA — bunları ben vermediysem yazma. Şüphen varsa daha genel, iddiasız ama gene
   somut bir özellik seç. ÖZELLİKLE: o ürün TÜRÜNÜN fiziksel olarak yapamayacağı ya da
   sahip olmayacağı bir işlev/özellik ASLA uydurma (örn. bir cezve/turka kahve çekirdeği
   öğütmez, sadece pişirir/kaynatır — "öğütme" gibi o kategoriye ait olmayan bir işlevi
   asla yazma). Emin değilsen ürünün ADINDA açıkça geçen kelimelere sadık kal.
6. Marka adını, model kodunu veya ürüne özel isimleri başlık/sloganların İÇİNE yazma —
   onlar ayrı bir yerde zaten gösteriliyor, sadece sen tekrar yazma.
7. Reklam dili kullan (iddialı, kısa, çekici) ama yanıltıcı/asılsız olmasın.
8. TEKRAR YASAK — aynı kelimeyi (örn. "хлопок...хлопок") başlık ve sloganlar arasında ya
   da bir sloganın kendi içinde tekrar etme. Üç metin de birbirinden farklı kelimeler
   kullanmalı, hiçbiri diğerinin eş anlamlısı ya da tekrarı olmasın.
9. ÜRÜN TÜRÜNÜ YANLIŞ YAZMA — başlık, ürün adında geçen türü (kolye/yüzük/bileklik,
   havlu/çarşaf, kap/cihaz vb.) ASLA başka bir türle karıştırmasın. Örn. üründe "Pendant
   Necklace" (kolye) yazıyorsa başlıkta "кольцо"/"печатка" (yüzük) yazma — türü ürün
   adındaki kelimeye sadık kalarak Rusça'ya çevir, farklı bir ürün türüne dönüştürme.

Sadece şu JSON formatında cevap ver, başka hiçbir şey yazma (başka dil, açıklama, markdown
kullanma): {"title": "BÜYÜK HARF BAŞLIK", "slogan1": "İlk slogan", "slogan2": "İkinci slogan"}

Ürün adı: `;

export async function generateSloganSet(productName: string): Promise<SloganSet> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY tanımlı değil");
  }

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT_TEMPLATE + productName }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.5 },
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

  const parsed = JSON.parse(extractFirstJsonObject(text)) as SloganSet;
  if (!parsed.title || !parsed.slogan1 || !parsed.slogan2) {
    throw new Error("Gemini beklenen alanları döndürmedi");
  }

  // Nadiren model bir kelimeyi başka bir sloganla birleştirip bozuyor (örn.
  // "аксессуадаптивная") — normal bir Rusça kelime bu kadar uzun olmaz, bunu
  // bozulma belirtisi sayıp hata fırlatıyoruz ki kullanıcı "yeniden oluştur" ile tekrar deneyebilsin.
  const MAX_WORD_LENGTH = 22;
  const allWords = `${parsed.title} ${parsed.slogan1} ${parsed.slogan2}`.split(/\s+/);
  if (allWords.some((word) => word.length > MAX_WORD_LENGTH)) {
    throw new Error("Gemini bozuk bir çıktı üretti, lütfen tekrar deneyin");
  }

  return parsed;
}
