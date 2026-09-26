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

## 3. Ozon "Topla" (paketleme onayı + gerekirse bölme) akışı (KOD YAZILDI — CANLIDA KISMEN TEST EDİLDİ)

**GERÇEK CANLI TEST SONUÇLARI (2026-09-11):**
- **Tek kutulu (bölmesiz) "Topla": BAŞARILI.** Gerçek bir siparişte (72904747-0230-1) denendi,
  sipariş gerçekten paketlendi (local durum doğru şekilde `awaiting_deliver`'a geçti). Kargo
  etiketi ilk denemede "henüz hazır değil" hatası verdi — bu BEKLENEN bir davranış (Ozon etiketi
  paketlemeden birkaç dakika sonra üretiyor), birkaç dakika sonra tekrar denenince inmesi gerekiyor.
- **Kutuya bölme: İLK DENEME BAŞARISIZ OLDU, KÖK NEDEN BULUNUP DÜZELTİLDİ.** Gerçek bir siparişte
  (71019016-0179-1, 2 adet tek ürün) "2 kutuya böl" denendi, Ozon **`POSTING_DOES_NOT_HAVE_MULTI_BOX_PRODUCT`**
  hatasıyla reddetti. Sipariş bulunduğu duruma GÜVENLE geri döndü (kilit serbest, hiçbir gerçek
  sevkiyat isteği gitmedi — doğrulandı). **Kök neden:** `/v3/posting/multiboxqty/set` uç noktası
  kullanılmıştı, ama bu uç nokta BAMBAŞKA bir senaryo için (rFBS Aggregator şeması + Ozon'un TEK bir
  ürünü "çok kutulu" olarak işaretlediği, standart FBS'te geçersiz olan bir durum). Kullanıcının
  Ozon panelinden doğrudan doğruladığı gibi bu siparişin bölünmesi mümkün VE gerekliydi, sadece
  yöntem yanlıştı. **Doğru yöntem (resmi Ozon dokümantasyonunda birebir örnekle doğrulandı):**
  `multiboxqty/set`'e HİÇ gerek yok — `/v4/posting/fbs/ship` isteğindeki `packages` dizisine
  BİRDEN FAZLA eleman göndermek (ör. 2 adetlik tek ürünü 2 kutuya bölmek için: `packages: [{products:
  [{product_id, quantity: 1}]}, {products: [{product_id, quantity: 1}]}]`). Kod bu şekilde düzeltildi
  (bkz. `orders.service.ts` `distributeIntoPackages`), `setMultiBoxQty` tamamen kaldırıldı. **Bu
  düzeltilmiş hali HENÜZ canlıda tekrar denenmedi** — bir sonraki adım kullanıcının aynı ya da
  benzer bir siparişte bölmeyi tekrar denemesi.

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
- ~~Kutuya bölme: ayrı bir endpoint — `POST /v3/posting/multiboxqty/set`...~~ **YANLIŞ ÇIKTI —
  bkz. yukarıdaki "GERÇEK CANLI TEST SONUÇLARI".** Bu uç nokta standart FBS'te bölme için
  KULLANILMAMALI, gerçek bir siparişte `POSTING_DOES_NOT_HAVE_MULTI_BOX_PRODUCT` hatasıyla
  reddedildi. Doğrusu: `ship` isteğinin `packages` dizisine birden fazla eleman göndermek.
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

**Kod yazıldı (2026-09-10):**
- `src/ozon/orders.ts`: `shipFbsPosting` artık `/v4/posting/fbs/ship` kullanıyor; yeni `setMultiBoxQty`
  fonksiyonu `/v3/posting/multiboxqty/set`'i çağırıyor.
- **`product_id` alanı hakkında KRİTİK bulgu (ayrı bir araştırmayla doğrulandı):** Ozon'un ship
  isteğindeki `product_id` alanı ismine rağmen aslında **SKU** bekliyor (resmi dokümantasyon: "Product
  identifier in the Ozon system, SKU") — projenin gerçek sipariş verisinde zaten ayrı bir `product_id`
  alanı YOK, sadece `sku` var. Bu, projenin daha önce faturalarda ("posting doesn't contain
  product_id", 2026-08-13) düştüğü AYNI tuzak. Bu yüzden kodda katalog seviyesindeki
  `Product.ozonProductId` DEĞİL, siparişin kendi `OrderItem.ozonSku` alanı kullanılıyor.
- `src/modules/orders/orders.service.ts`'e `shipOrder(postingNumber, multiBoxQty?)` eklendi —
  durumun `awaiting_packaging` olduğunu ve her kalemde `ozonSku` bulunduğunu kontrol ediyor,
  gerekirse önce `setMultiBoxQty` sonra `shipFbsPosting` çağırıyor, başarılı olursa siparişin güncel
  durumunu Ozon'dan tekrar çekip local DB'yi güncelliyor.
- `app/api/orders/[postingNumber]/ship/route.ts` (yeni) ve `app/orders/[postingNumber]/
  ShipOrderButton.tsx` (yeni) — sadece `awaiting_packaging` durumundaki siparişlerde görünen "Topla"
  butonu, toplam ürün adedi 1'den fazlaysa kutu sayısı soran bir form, ve "Evet, Paketle" ile ayrı bir
  onay adımı (geri alınamaz olduğu açıkça yazıyor).
- **Çift sevkiyat koruması (3 turluk code review sonrası netleşti):** `Order.shipClaimedAt` diye
  yeni, ayrı bir alan eklendi (migration: `20260910140000_add_order_ship_claimed_at`) — çift
  tıklama/iki açık sekme aynı siparişi aynı anda paketlemeye çalışırsa Ozon'a GERÇEK bir çift
  sevkiyat isteği gitmesin diye. BİLEREK `status` alanı kullanılmadı: 15 dakikada bir çalışan
  senkronizasyon cron'u (`syncFbsOrders`) `status`ü Ozon'dan gelen gerçek değerle her seferinde
  eziyor, o alana yazılan bir kilit cron tarafından silinip korumayı etkisiz bırakabilirdi (aynı
  sebeple Paraşüt fatura kilidi de `parasutInvoiceId` diye ayrı bir alan kullanıyor). Ayrıca:
  Ozon'a giden yazma isteklerinde (`shipFbsPosting`/`setMultiBoxQty`) otomatik retry KAPATILDI
  (`ozonPost`'a yeni `{ retry: false }` seçeneği eklendi) — Ozon isteği gerçekten işleyip cevabı
  kaybettiği bir durumda otomatik tekrar denemenin GERÇEK bir ikinci sevkiyata yol açmaması için.
  `shipFbsPosting` hata verirse (isteğin Ozon'a ulaşıp ulaşmadığı belirsiz), kilidi körlemesine
  geri almak yerine Ozon'un güncel durumu bizzat sorulup gerçeğe göre karar veriliyor; bu
  doğrulama bile başarısız olursa sipariş BİLEREK kilitli bırakılıyor (kullanıcı Ozon panelinden
  kontrol etmeden tekrar deneyemesin diye) — bu durum artık ayrıca loglanıyor da (ilk yazımda
  sessizce yutuluyordu). **Kilit kalıcı olarak takılırsa** (Ozon panelinden GERÇEKTEN
  paketlenmediği doğrulandıktan SONRA): `npx tsx src/scripts/clear-stuck-ship-claim.ts
  <postingNumber>` ile elle temizlenir (yeni script, henüz kullanılmadı).
- Kod incelemesinden geçirildi (6 tur — bir turda script'in onay sorusunu EKRANA YAZIP cevabı hiç
  BEKLEMEDEN kilidi her zaman temizlediği yakalandı, düzeltildi: artık gerçek bir "evet" onayı
  gerekiyor), `tsc` temiz. **Ozon'a GERÇEK bir yazma isteği attığı için bunu script/terminalden
  test etmeye çalıştığımda güvenlik sınıflandırıcısı engelledi — bu isabetli bir uyarıydı,
  denemedim.**

**Bilinen sınırlamalar (bilerek bu turda çözülmedi, kapsam dışı bırakıldı):**
1. **Zorunlu ürün işaretleme (Честный знак / "Chestny Znak") verisi gönderilmiyor.** Ayakkabı,
   tekstil, parfüm gibi bazı kategorilerde Ozon, paketleme onayından önce ayrı bir "exemplar" (ürün
   örneği) uç noktasına işaretleme kodu göndermeyi zorunlu tutuyor olabilir. Bu proje o veriyi hiç
   toplamıyor/saklamıyor. Böyle bir siparişte "Topla" denenirse Ozon muhtemelen AÇIK bir hatayla
   reddedecek (sessizce yanlış bir şey olmaz) ama sipariş bu özellikle paketlenemeyecek —
   kullanıcı o siparişi Ozon'un kendi panelinden paketlemeli. Bunu tam desteklemek ayrı, kapsamlı
   bir özellik gerektirir.
2. **Bölünen (multi-box) siparişlerin yeni posting numaraları, bir sonraki sync cron turuna kadar
   (en fazla 15 dakika) çift-işlem korumasına sahip değil** — çünkü koruma `Order` satırının kendi
   `shipClaimedAt` alanına bağlı, yeni posting numaraları için satır henüz yok. Pratikte düşük
   riskli (birinin o yeni posting numarasını o dar pencerede tekrar "Topla" ile denemesi gerekir)
   ama bilinmeli.
3. **`ozonPost`'un yeni `{ retry: false }` koruması SADECE bu turda dokunulan uçlara
   (`shipFbsPosting`/`setMultiBoxQty`/`cancelFbsPosting`) eklendi** — projede daha önceden var olan
   diğer gerçek/geri alınamaz Ozon yazma istekleri (ör. `src/ozon/invoices.ts`'teki fatura
   oluşturma, `src/ozon/products.ts`'teki fiyat/stok güncelleme) hâlâ varsayılan otomatik retry'a
   sahip — 5xx/429'da cevap kaybolursa aynı çift-işlem riski teorik olarak onlarda da var. Bu turun
   kapsamı sadece "Topla" özelliğiydi, o yüzden bu turda dokunulmadı; ayrı bir oturumda gözden
   geçirilebilir (2026-09-10'da code review'da tespit edildi).

**Sonraki adım — HÂLÂ kullanıcı onayı gerekiyor, hiçbir gerçek siparişte denenmedi:**
İlk gerçek test, kullanıcının kendi seçtiği, önemsiz, tek bir `awaiting_packaging` siparişinde,
arayüzden (Siparişler → o sipariş → "Topla" butonu) elle yapılmalı. Bölme (multi-box) özelliği ancak
temel (tek kutulu) akış gerçek bir siparişte doğrulandıktan sonra denenmeli.

## 4. Shopify stok → Ozon + toptantr senkronu (TEMEL ALTYAPI YAZILDI — DB MIGRATION + CREDENTIAL BEKLIYOR, 2026-09-26)

**GÜNCELLEME (2026-09-26, aynı gün devamı):** Kullanıcı kararı: "ozonapi çok daha büyük bir proje,
toptantr'ı buraya taşıyalım — tek ürün içinden ozon ve toptantr tabları olsun, ürünü ozona bağla/
toptantr'a bağla seçeneği olsun." VPS'te (72.62.93.209) `/var/www/toptantr-shopify-sync` adında
TAM ÇALIŞAN ayrı bir Node.js projesi bulundu (Shopify→toptantr, Gemini çeviri + kategori/marka
eşleştirme, USD→TL fiyatlama) — ama 13 Temmuz'dan beri hiç çalışmamış (crontab'da yok). Bu projenin
MANTIĞI ozonapi'ye taşındı (dosyaların kendisi değil, JS→TS yeniden yazıldı):

- `prisma/schema.prisma`: `Product.barcode` (yeni alan, CSV'de vardı ama hiç saklanmıyordu),
  `Product.toptantrApproved` (varyant bazlı gönderim onayı), yeni `ToptantrListing` modeli (handle
  bazlı — toptantr TEK üründe en fazla 4 kombinasyon/Adet-Paket-Koli-Palet kabul ediyor, Ozon'un
  aksine varyant bazlı değil), yeni `ToptantrMappingCache` (vendor+type → kategori/marka guid,
  Gemini'ye tekrar tekrar sormamak için).
  **MIGRATION HENÜZ ÇALIŞTIRILMADI** — `prisma migrate dev` bu makineden "Production Deploy" olarak
  engellendi (bu checkout doğrudan canlı DB'ye bağlanıyor). Kullanıcı ya kendisi
  `npx prisma migrate dev --name add_toptantr_integration` çalıştırmalı ya da bu komuta izin
  vermeli. Migration çalışmadan yeni alanları kullanan hiçbir kod (toptantr modülleri, yeni API
  route'ları, ToptantrPanel.tsx) DB'ye karşı çalışmaz (Prisma client zaten `generate` ile tip
  üretildi, sadece gerçek migration eksik).
- `src/toptantr/client.ts` — toptantr API client'ı (token auth, createProduct/updateProduct/
  findProductByBarcode/updateCombinations) — VPS'teki `toptantrClient.js`'in TS'e taşınmış hali,
  **gerçek API doğrulamasıyla** (VPS'teki çalışan `pipeline.js`'in tam akışı okunarak: `/combinations`
  ucu barkodla DEĞİL, `findProductByBarcode`'un döndürdüğü kombinasyon `id`'siyle çalışıyor — bu
  ayrım koda yorum olarak da işlendi, karıştırılması kolay bir nokta).
- `src/toptantr/quantity.ts` — VPS'teki regex tabanlı paket-adedi çıkarımı YERİNE ozonapi'de zaten
  var olan `Product.unitsInPack` alanı kullanılıyor (Ozon için zaten tutuluyordu, aynı veri
  toptantr'ın Adet/Paket/Koli/Palet sıralamasına da direkt uyuyor) — daha az kod, tek doğruluk kaynağı.
- `src/toptantr/pricing.ts`, `src/toptantr/translate.ts` (Türkçe çeviri, Gemini), `src/toptantr/categoryMatch.ts`
  (kategori/marka Gemini eşleştirme, anahtar-kelime ön-filtreli), `src/toptantr/mapping.ts` (kategori/
  marka TTL cache + DB'deki vendor/type eşleştirme önbelleği).
- `src/modules/toptantr/toptantr.service.ts` — `getToptantrPreview(handle)`, `connectHandleToToptantr()`,
  `refreshToptantrHandle()` — Ozon'daki `submitHandleToOzon`'un toptantr karşılığı, aynı "self-heal"
  (barkod çakışırsa PUT'a düş) ve "indekslenme gecikmesi" (retry ile bekleme) mantığı dahil.
  **NOT YAPILMADI:** VPS'teki orijinal projedeki `state.js` (processed.json, ürün başına
  translatedTitle/approved geçmişi) burada `ToptantrListing` tablosuna taşındı ama "ürün DAHA ÖNCE
  approve edilmiş miydi, tekrar sorma" gibi ince noktaların hepsi bire bir doğrulanmadı — ilk gerçek
  testte dikkatli bakılmalı.
- API route'ları: `app/api/import/products/[handle]/toptantr/route.ts` (GET önizleme, POST bağla),
  `.../toptantr/refresh/route.ts` (POST stok/fiyat yenile), `app/api/toptantr/categories|brands/route.ts`
  (arama). `app/api/import/variant/[offerId]/route.ts`'e `toptantrApproved` PATCH alanı eklendi.
- UI: `app/import/[handle]/HandleEditor.tsx`'e "Ozon" / "toptantr" sekme geçişi eklendi (mevcut
  koca Ozon bloğu `{activeTab==="ozon" && (...)}` içine alındı, davranışı DEĞİŞMEDİ), yeni
  `app/import/[handle]/ToptantrPanel.tsx` (kademe onay checkbox'ları, kategori/marka arama, Bağla/
  Yenile butonları, fiyat anomalisi uyarısı).

**Kalan gerçek blokerler:**
1. **DB migration çalıştırılmadı** (yukarıda açıklandı) — bu olmadan hiçbir toptantr özelliği
   gerçekte çalışmaz, sadece typecheck geçer.
2. **`.env`'e gerçek toptantr credential'ları eklenmedi** — `TOPTANTR_BASE_URL`/`TOPTANTR_USERNAME`/
   `TOPTANTR_PASSWORD` VPS'teki `/var/www/toptantr-shopify-sync/.env`'de duruyor, buraya otomatik
   taşıma (SSH ile çekip yerel `.env`'e ekleme) "dangerous" olarak engellendi — kullanıcı ya
   VPS'teki değerleri kendisi kopyalayıp buraya eklemeli, ya da bana açıkça yapıştırmalı.
3. **`GEMINI_API_KEY` zaten `.env`'de var (Rusça çeviri için) ama toptantr Türkçe çevirisi/kategori
   eşleştirmesi için de AYNI key kullanılıyor** — ayrı bir key gerekmiyor, ama kullanım hacmi
   artacağı unutulmamalı (rate limit/quota).
4. **Barkod verisi eksik olabilir** — `Product.barcode` yeni bir alan, mevcut 6270 üründe muhtemelen
   hepsi NULL (CSV'de vardı ama hiç kaydedilmiyordu). `barcodeOf()` boşsa offerId'ye (SKU) düşüyor,
   bu YETER ama ideal değil — canlı Shopify'dan barkodu geri çekip backfill etmek (bkz. madde 4'ün
   ilk hâlindeki `src/shopify/inventory.ts` bulk operation deseni, `barcode` alanı eklenerek) ayrı
   bir iş.
5. **Hiç gerçek üründe denenmedi.** İlk test kullanıcının seçtiği, önemsiz TEK bir üründe, arayüzden
   ("toptantr" sekmesi → kategori seç → bir kademe onayla → "toptantr'a Bağla") elle yapılmalı —
   toplu/otomatik bir şey YOK, hepsi manuel buton.

**GÜNCELLEME (2026-09-26, aynı gün — "hem ozonda hem toptantr'da bağlı ürünler var, bu nasıl
olacak?" sorusu üzerine):** Gerçek bir risk tespit edildi ve doğrulandı — **DÜZELTİLMEDİ, migration
bekliyor.**

Risk: eski (Temmuz'a kadar çalışan) VPS'teki toptantr-shopify-sync, bazı ürünleri GERÇEKTEN
toptantr'a bağlamış (72 ürün, `status: success`). Bizim yeni `ToptantrListing` tablomuz bundan
HABERSİZ (boş) — bu ürünlerden birinde "Bağla"ya basılırsa `connectHandleToToptantr` bunları "hiç
bağlanmamış" sanıp `createProduct` çağırır. Kod self-heal (duplicate-barcode hatası yakalayıp
`findProductByBarcode`'a düşme) içeriyor AMA `Product.barcode` alanı yeni eklendi ve henüz hiçbir
üründe dolu değil — `barcodeOf()` bu yüzden SKU'ya düşüyor, ki bu toptantr'da o ürün için KAYITLI
GERÇEK barkodla (Shopify barkod alanı, SKU'dan tamamen farklı bir değer) uyuşmuyor. Sonuç: hata
YAKALANMAZ, toptantr'da gerçek bir MÜKERRER ürün oluşur.

Çözüm (yazıldı, migration'ı bekliyor): VPS'teki `/var/www/toptantr-shopify-sync/data/processed.json`
(o eski projenin kendi state dosyası — hangi ürünün hangi toptantr id/kategori/marka/çeviriyle
bağlandığını tutuyor) `private-uploads/toptantr-legacy/processed.json`'a kopyalandı (gitignore'da,
gizli değil ama commit'lenmeyecek iş verisi). `src/scripts/reconcile-toptantr-legacy.ts` bunu okuyup
SKU eşleştirmesiyle (72 üründe **%100 eşleşme** doğrulandı, dry-run'da test edildi)
`ToptantrListing`'i doğru `status: success` + toptantrProductId/kategori/marka/çeviri ile önceden
doldurur — bu sayede bu 72 ürün panelde baştan "zaten bağlı" görünür, "Bağla" hiç tıklanamaz/
tetiklenmez, sadece "Yenile" kullanılabilir.

**Migration çalıştırıldıktan sonra (madde 4'teki ilk blokerle aynı), herhangi bir ürün panelden
"Bağla"lanmadan ÖNCE mutlaka çalıştırılmalı:**
```
npx tsx src/scripts/reconcile-toptantr-legacy.ts            # önce dry-run, çıktıyı kontrol et
npx tsx src/scripts/reconcile-toptantr-legacy.ts --apply     # sonra gerçekten uygula
```

**2 üründe elle karar gerekiyor** (script bunları otomatik atlıyor, ToptantrListing'e yazmıyor) —
aynı 2 ürün, 2026-09-26'daki Shopify↔CSV SKU denetiminde de "handle uyuşmazlığı" olarak tespit
edilmişti (bkz. o zamanki sohbet): Shopify'da ürün sonradan yeniden adlandırılmış/kopyalanmış,
şu an aynı eski toptantr kaydının SKU'ları YENİ İKİ FARKLI Shopify handle'ına bölünmüş durumda:
- `handmade-dubai-chocolate-with-pistachio-kadayif-tahini-42g-low-sugar-gourmet-treat` /
  `vegan-bitter-dubai-chocolate-70-bitter-chocolate-with-pistachio-kadayif-and-tahini-42g`
- `pistachio-praline-dubai-chocolate-bar-crispy-nutty-delight-73gr` /
  `pistachio-praline-dubai-chocolate-bar-crispy-nutty-delight-71gr-copy`

Bu ikisi için hangi GÜNCEL handle'ın gerçek toptantr kaydını temsil ettiğine kullanıcı karar
vermeli, script'e elle (ya da script'i genişleterek) eklenmeli — otomatik tahmin YAPILMADI çünkü
yanlış handle'a yazmak, YANLIŞ bir ürünü "zaten bağlı" gösterip asıl bağlanması gereken ürünün hiç
bağlanamamasına yol açabilir.

**Genel (72'nin dışında kalan, gelecekteki tüm ürünler için) kalıcı çözüm hâlâ eksik:**
`Product.barcode`'un gerçek Shopify barkoduyla doldurulması — `src/shopify/inventory.ts`'teki bulk
operation deseni `barcode` alanı da isteyecek şekilde genişletilip SKU eşleşmesiyle backfill
edilmeli (ayrı bir script, henüz yazılmadı) — bu olmadan yeni bağlanan ama iki kere denenen (ör.
yarım kalmış bir istekten sonra tekrar "Bağla"ya basılan) ürünlerde de aynı sınıf risk teorik olarak
var, sadece 72'lik legacy liste için pratik risk giderildi.

**Eski (ilk hâldeki) plan aşağıda hâlâ geçerli** — Shopify stok pull kısmı (`src/shopify/inventory.ts`,
`src/shopify/exclusions.ts`) DEĞİŞMEDEN duruyor, toptantr'a bağlanan ürünlerin stoğunu güncellerken
(refreshToptantrHandle şu an sadece DB'deki `stockQuantity`'i kullanıyor) o modülle entegre edilmesi
gerekecek — henüz edilmedi.

**İstek (kullanıcı, 2026-09-26):** "Shopify stokları source of truth olacak, kolajen ve vitamin vs
gibi ürünler hariç. Bir de VPS'te toptantr entegrasyonumuz var API'yle. Bu Ozon API'ye Shopify stok
çekeceğiz, bunları toptantr ve Ozon'a bağlayacağız. Ozon tarafı zaten hazır, amaç stok çekmek ve hem
toptantr hem Ozon'da satmak."

**Şu ana kadar yazılan (test edildi, canlı Shopify'dan gerçek veri çekiyor):**
- `src/shopify/client.ts` — Shopify Admin GraphQL client (axios, `SHOPIFY_STORE_DOMAIN`/
  `SHOPIFY_ADMIN_API_TOKEN`/`SHOPIFY_API_VERSION` env, `.env`'e zaten eklendi: mağaza `omg-silk`,
  B2C token).
- `src/shopify/inventory.ts` — `fetchShopifyStockByLocation()`: bulk operation ile (mağazada
  113.000+ varyant olduğu için sayfalı sorgu yerine) belirli bir lokasyondaki (varsayılan
  `SHOPIFY_STOCK_LOCATION_ID` — İstanbul deposu, `gid://shopify/Location/66272723182`) tüm SKU +
  mevcut ("available") stoğu çeker. Negatif stok (canlıda görülen overselling durumları, ör. -1/-2/-9)
  0'a sabitleniyor.
- `src/shopify/exclusions.ts` — `isExcludedFromStockSync()`: kolajen/vitamin/takviye ürünlerini
  SKU/handle/isim üzerinde anahtar kelimeyle (collagen, vitamin, vita1, supplement, glutathione,
  hyaluronic, ch alpha, vb.) tespit ediyor. **DİKKAT:** bu bir heuristik — `shopifyVendor`/
  `shopifyType` alanları DB'de TÜM ürünlerde boş olduğundan (CSV'de hiç doldurulmamış) kategoriye
  göre değil anahtar kelimeye göre çalışıyor, yanlış pozitif/negatif verebilir.
- `src/scripts/shopify-stock-dry-run.ts` — hiçbir yere yazmayan, sadece rapor basan test script'i.
  `npx tsx src/scripts/shopify-stock-dry-run.ts` ile çalıştırılır. Son çalıştırmada (2026-09-26):
  6270 Shopify-origin üründen 6074'ü Shopify'da SKU ile eşleşiyor, 125'i kolajen/vitamin heuristiğiyle
  dışlandı (örnekler script çıktısında listeleniyor, kullanıcı gözden geçirmeli), 71'i eşleşmiyor
  (ama bunlar 2026-09-26'daki SKU denetiminde tespit edilen "CSV'de SKU'su boştu, sahte offerId
  üretildi" durumunun aynısı — gerçek eksik değil).

**Neden push tarafı yazılmadı (gerçek blokerler):**
1. **toptantr API'si hakkında hiçbir bilgi yok** — `/Users/aladdin/.../server/toptantr` klasörü
   tamamen boş, `ozonapi` içinde de "toptantr" geçen hiçbir kod yok. Endpoint, auth yöntemi, request/
   response şeması, ürün eşleştirme alanı (SKU mu, başka bir id mi) — hiçbiri bilinmiyor. VPS'teki
   gerçek entegrasyonun kod/dokümantasyonuna bakılması ya da kullanıcıdan API spesifikasyonu alınması
   gerekiyor.
2. **Kolajen/vitamin dışlama listesi kullanıcı tarafından onaylanmadı** — yukarıdaki heuristik ile
   125 ürün dışlandı, ama bu KESİN değil (ör. "vitamin enriched jelly chews" gibi asıl şeker/gıda
   ürünü olup adında "vitamin" geçtiği için yanlışlıkla dışlanmış olabilecek satırlar var, script
   çıktısındaki "örnek dışlanan ürünler" listesine bakılmalı).
3. **Ozon'a gerçek stok push'u canlı sipariş akışını etkiler** — mevcut `updateStocks`/
   `selectWarehouseId` (`src/ozon/products.ts`, `src/ozon/warehouses.ts`) hazır ve reuse edilebilir
   durumda, ama hangi ürünlerin ne zaman/ne sıklıkla güncelleneceği (cron'a mı eklenecek, `runSync`
   gibi 15 dakikada bir mi, yoksa daha seyrek mi) kullanıcı kararı gerektiriyor — yanlış/erken
   otomatikleştirme toplu stok hatasına yol açabilir (bkz. bu dosyadaki diğer maddelerde tekrar eden
   "otomatikleştirmeden önce kullanıcı onayı" deseni).

**Nasıl devam edilmeli:**
1. `npx tsx src/scripts/shopify-stock-dry-run.ts` çalıştırılıp "örnek dışlanan ürünler" listesi
   kullanıcıyla gözden geçirilmeli — heuristik yanlışsa `src/shopify/exclusions.ts` düzeltilmeli
   (ör. gerçek bir "hariç tutulacak SKU/handle listesi" dosyası ile heuristiği DEĞİL, tam liste ile
   değiştirmek daha güvenli olabilir).
2. toptantr API detayları netleşince `src/toptantr/client.ts` + `src/toptantr/stock.ts` (Ozon
   client'ının aynı deseniyle: axios, retry, tipli hata sınıfı) yazılmalı.
3. Ozon tarafı için: `fetchShopifyStockByLocation()` sonucunu `Product.offerId`'ye göre eşleyip,
   dışlanmamış + `ozonProductId` dolu ürünler için mevcut `updateStocks` ile push eden bir fonksiyon
   (`syncShopifyStockToOzon`, `products.service.ts`'e eklenebilir) yazılmalı — `backfillMissingStock`
   ile aynı dosyada, aynı desende.
4. İlk gerçek push MUTLAKA küçük bir örneklemle (ör. 5-10 ürün) elle test edilmeli, sonra
   `src/scripts/sync-orders-cron.ts`'e (mevcut cron process'i) yeni bir zamanlanmış fonksiyon olarak
   eklenmeli — kullanıcı onayı olmadan otomatik/periyodik çalışmaya BAŞLAMAMALI.
