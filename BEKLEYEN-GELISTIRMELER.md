# Bekleyen Geliştirmeler / Bilinen Buglar

Bu dosya, henüz yapılmamış ama konuşulmuş işleri ve tespit edilip ileri bir tarihe bırakılan
bugları takip etmek için (2026-09-10'da oluşturuldu). Her madde için ne istendiği, neden henüz
yapılmadığı ve nereden devam edileceği yazılıyor.

## 1. TL satış fiyatı — fatura kesildiği günün kuruyla kilitlenen (YAPILDI — 2026-09-10)

Aşağıdaki plan aynen uygulandı: `Order.parasutInvoiceFxRate` alanı eklendi (migration
`20260910110000_add_order_parasut_invoice_fx_rate`), `src/parasut/orderInvoice.ts` fatura
kesilirken kullanılan kuru bu alana kaydediyor, `app/orders/page.tsx`'te "TL Satış Fiyatı" sütunu
kesin (₺, hover'da "gerçek fatura kuru") ile tahmini ("~₺", hint rengi, hover'da "henüz fatura
kesilmedi") değerleri görsel olarak ayırarak gösteriyor.

**İstek:** Siparişler listesine, o siparişin satış tutarının TL karşılığını gösteren bir sütun
eklenmesi. Kritik nokta: bu TL değeri **fatura kesildiği günün kuruyla sabitlenmeli** — yani
fatura kesildikten sonra kur değişse bile o siparişte hep aynı TL rakamı görünmeli (gerçek Paraşüt
faturasındaki tutarla birebir eşleşsin diye). Henüz faturası kesilmemiş siparişlerde ise "eğer
mümkünse" o günün (bugünün) canlı kuruyla tahmini bir TL değeri gösterilebilir, ama bunun kesin
olmadığı açıkça belirtilmeli.

**Neden yapılmadı:** Diğer acil bug düzeltmeleri (arama çökmesi, etiket 400 hatası, fatura numarası
sorunu vb.) araya girdi.

**Nasıl yapılmalı (plan):**
1. `Order` modeline `parasutInvoiceFxRate Float?` (ya da benzeri) alanı eklenir — migration gerekir.
2. `src/parasut/orderInvoice.ts`'te fatura kesilirken zaten `const rate = await getUsdToTryRate();`
   çağrılıyor (bkz. `doCreateInvoiceForOzonOrder`) — bu değer artık `prisma.order.update` çağrısına
   `parasutInvoiceFxRate: rate` olarak eklenip kalıcı olarak saklanmalı.
3. Siparişler listesinde (`app/orders/page.tsx`) yeni bir "TL Satış Fiyatı" sütunu: eğer
   `order.parasutInvoiceFxRate` doluysa `computeOrderAmount(items) * rate` (kesin, "gerçek fatura
   kuru" etiketiyle); doluysa değilse `computeOrderAmount(items) * bugünküCanlıKur` (tahmini,
   "~tahmini" etiketiyle, `getUsdToTryRate()` ile).
4. Daha önce (bu değişiklikten önce) kesilmiş faturalarda `parasutInvoiceFxRate` boş kalacak —
   onlar için sadece bugünkü kurla tahmini gösterilir, gerçek değer geriye dönük hesaplanamaz
   (Paraşüt'ten fatura detayını tek tek çekmek gerekirdi, rate limit riski taşır — bkz. aşağıdaki
   not).
5. **Dikkat:** Bu proje boyunca para birimi hataları (RUB/USD karışması, tahmini kur riski) kullanıcı
   için çok hassas bir konu oldu — "kesin" ile "tahmini" değerler UI'da MUTLAKA görsel olarak ayrı
   gösterilmeli, karıştırılmamalı.

## 2. "Nuri Toplar" ürününde 404 hatası (YAPILDI — 2026-09-10)

**Bug:** `/products/nuritoplar250fındık` (offerId'si Türkçe'ye özgü noktasız "ı" harfi içeren bir
ürün — tam adı: "Турецкий кофе Kurukahveci Nuri Toplar со вкусом фундука, молотый, жестяная банка,
250 г") açılınca "This page could not be found" (404) hatası veriyor.

**Gerçek kök neden (geçici bir `console.log` ile ve kimlik doğrulamalı `curl` testleriyle
doğrulandı):** `encodeURIComponent` tutarsızlığı hipotezi YANLIŞ çıktı — sorun link oluşturmada
değildi. Next.js 15.5.22, `app/products/[offerId]/page.tsx`'teki dinamik route segmentini
OTOMATİK ÇÖZMÜYOR (decode etmiyor): tarayıcı "ı" gibi Türkçe karakterleri URL'e yazarken kendiliğinden
yüzde-kodluyor (`%C4%B1`), ama `params.offerId` bize hâlâ `"nuritoplar250f%C4%B1nd%C4%B1k"` kodlu
haliyle geliyordu — bu, DB'deki düz `"nuritoplar250fındık"` değeriyle eşleşmediği için `getProduct`
`null` dönüyor ve `notFound()` tetikleniyordu. (DB tarafında hiçbir sorun yoktu, offerId'nin
bayt/kod noktaları tamamen sağlamdı — bu daha önce de doğrulanmıştı.)

**Çözüm (birkaç turluk code review sonrası netleşti — ÖNEMLİ bir Next.js tuhaflığı var):**
Next.js App Router'da `page.tsx` (Server Component) ile `route.ts` (API route/Route Handler)
dinamik route segmentini **FARKLI** ele alıyor:
- `page.tsx`'e gelen `params` **ÇÖZÜLMEMİŞ** geliyor — bu yüzden `app/products/[offerId]/page.tsx`'te
  `decodeURIComponent` (güvenli sarmalı: `src/utils/decodeOfferId.ts`) MUTLAKA gerekiyor.
- `route.ts`'e gelen `params` Next tarafından **ZATEN OTOMATİK ÇÖZÜLMÜŞ** oluyor — buraya AYRICA
  `decodeURIComponent` eklemek (bir ara turda yanlışlıkla eklenmişti, gerçek `curl` testiyle
  yakalanıp geri alındı) offerId'de literal "%" varsa (ör. gerçek DB'de var olan
  "TURKOBABA-100%-342G-6974") **ÇİFT ÇÖZME**'ye yol açıp ürünü bulamıyordu (cost-price/status/
  confirm-weight/clone-data/variant route'larının hepsinde).
- Ayrıca offerId linki oluşturan HER yerde (`app/products/page.tsx`, `app/orders/[postingNumber]/
  page.tsx`, `ProductEditForm.tsx`, `ProductWizard.tsx`, `HandleEditor.tsx`, `CostPriceCell.tsx`,
  `RealWeightInput.tsx`, `PriceList.tsx`, `ImportProductForm.tsx` — bazıları hiç encode etmiyordu,
  bazıları tutarsızdı) artık ortak `productPath`/`productApiPath`/`variantApiPath` fonksiyonları
  (`src/utils/decodeOfferId.ts`) kullanılıyor — serbest `${encodeURIComponent(offerId)}` şablonu
  yazmayı unutmak yapısal olarak zorlaşsın diye.

Yerel sunucuda hem Türkçe karakterli hem gerçek "%" içeren (iki ayrı gerçek DB kaydı) hem düz ASCII
offerId'ler; hem sayfa hem API uçları (GET ve PATCH/POST yazma dahil) tek tek `curl` ile test edilip
hepsinin doğru çalıştığı doğrulandı.

## 3. Ozon "Topla" (paketleme onayı + gerekirse bölme) akışı (YAPILMADI, KAPSAMLI BİR ÖZELLİK)

**İstek:** Ozon panelinde, bir sipariş "awaiting_packaging" durumundayken "Topla" dendiğinde
paketleme onaylanıyor ve (ör. ağırlık yanlış girildiyse) siparişi birden fazla kutuya/gönderiye
bölme seçeneği çıkıyor. Kullanıcı bunun bizim sistemimizden de yapılabilmesini istiyor.

**Mevcut durum:** Sistemde bu akış HİÇ YOK — şu an sadece siparişleri okuyup gösteriyoruz ve
(Paraşüt'te) fatura kesiyoruz, Ozon'a sevkiyat/paketleme onayı gibi GERÇEK bir yazma isteği hiç
göndermiyoruz.

**Neden yapılmadı:** Bu, sistemde OLMAYAN yeni bir yetki sınıfı — Ozon'a gerçek sevkiyat/paketleme
onayı göndermek. Yanlış yapılırsa (yanlış kutu sayısı, yanlış ürün eşleştirmesi vb.) gerçek bir
siparişin sevkiyat sürecini bozabilir. Kullanıcı bunun ayrı, dikkatli bir oturumda ele alınmasını
istedi ("uzun sürecek", "ben ilerde yaparım").

**API araştırması TAMAMLANDI (2026-09-10, henüz KOD YAZILMADI, gerçek siparişe dokunulmadı):**
- Tek kutulu paketleme onayı: `POST /v4/posting/fbs/ship` — istek: `{ posting_number, packages:
  [{ products: [{ product_id, quantity }] }] }`, cevap: `{ result: string[] }` (bölünürse birden
  fazla posting numarası döner). **Not:** `src/ozon/orders.ts:58`'de zaten hiçbir yerden
  çağrılmayan, yarım bırakılmış bir `shipFbsPosting` fonksiyonu var ama o eski `/v2/posting/fbs/ship`
  sürümünü kullanıyor — gerçek çağrı öncesi güncel `/v4` sürümü resmi dokümantasyondan bir kez daha
  teyit edilmeli, kaynaklar arasında sürüm numarası tutarsızlığı görüldü.
- Kutuya bölme: ayrı bir endpoint — `POST /v3/posting/multiboxqty/set`, istek:
  `{ posting_number, multi_box_qty }`. **Akış sırası önemli:** önce `/v3/posting/fbs/get` ile
  siparişin `is_multibox` alanına bakılır (Ozon ağırlık/boyut tutarsızlığı tespit ederse kendisi
  `true` yapıyor); `true` ise `ship` çağrısından ÖNCE `multiboxqty/set` ile kutu sayısı bildirilmeli.
  Tek kutulu siparişlerde bu adım atlanıp doğrudan `ship` çağrılabilir.
- Ayrıca `/v4/posting/fbs/ship/package` diye üçüncü, kısmi paketleme için bir endpoint daha var
  (muhtemelen seri numarası zorunlu ürünler için) — bu özellik kapsamında şimdilik gerekli değil.
- **Kullanıcı notu (2026-09-10):** Ozon'un kendi panelinde, "ilk durumdaki" (awaiting_packaging)
  bir siparişte "Topla" dendiğinde, kutuya bölme seçeneği sadece paketteki ürün adedi 1'den
  FAZLAYSA çıkıyor — tek adetlik siparişlerde bu seçenek hiç gösterilmiyor. UI tasarlanırken
  (adım 2'deki "Topla" butonu/form) bu davranış birebir taklit edilmeli: bölme formu sadece
  toplam ürün adedi > 1 olan siparişlerde gösterilsin.
- **Kullanıcı notu (2026-09-10):** "Topla" işlemi siparişi 1. durumdan (awaiting_packaging) 2.
  duruma geçiriyor — kargo etiketi ANCAK bu geçiş yapıldıktan SONRA oluşuyor. Yani `ship`
  çağrısı sadece "paketlendi" bilgisini kaydetmiyor, aynı zamanda etiketin üretilmesini de
  tetikliyor — bu yüzden UI'da "Topla" butonu, etiket indirme akışıyla (varsa mevcut etiket
  kodundaki durum kontrolüyle) tutarlı olmalı.

**Sonraki adım (bir sonraki oturumda, KOD YAZILACAK — hâlâ kullanıcı onayı gerekiyor):**
1. `src/ozon/orders.ts`'teki `shipFbsPosting`'i güncel `/v4/posting/fbs/ship`'e taşı; aynı dosyaya
   `/v3/posting/multiboxqty/set` için yeni bir fonksiyon ekle (projenin mevcut `ozonPost` istemci
   üslubunda — bkz. `invoices.ts`).
2. `orders.service.ts`'e bu ikisini saran, "awaiting_packaging" durumunu kontrol eden bir servis
   fonksiyonu eklenir; `app/orders/[postingNumber]/page.tsx`'e sadece o durumdaki siparişlerde
   görünen bir "Topla" butonu + `is_multibox=true` ise kutu sayısı giren küçük bir form eklenir.
3. İlk gerçek test MUTLAKA kullanıcının onayıyla, tek ve önemsiz bir siparişte yapılmalı — yanlış
   `product_id`/`quantity` eşleşmesi ya da eksik `multiboxqty/set` çağrısı gerçek bir siparişin
   sevkiyatını bozabilir. Bölme (multi-box) özelliği ancak temel akış gerçek bir siparişte
   doğrulandıktan sonra eklenmeli.
