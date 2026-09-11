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
