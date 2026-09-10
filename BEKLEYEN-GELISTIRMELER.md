# Bekleyen Geliştirmeler / Bilinen Buglar

Bu dosya, henüz yapılmamış ama konuşulmuş işleri ve tespit edilip ileri bir tarihe bırakılan
bugları takip etmek için (2026-09-10'da oluşturuldu). Her madde için ne istendiği, neden henüz
yapılmadığı ve nereden devam edileceği yazılıyor.

## 1. TL satış fiyatı — fatura kesildiği günün kuruyla kilitlenen (YAPILMADI)

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

## 2. "Nuri Toplar" ürününde 404 hatası (KISMEN ARAŞTIRILDI, ÇÖZÜLMEDİ)

**Bug:** `/products/nuritoplar250fındık` (offerId'si Türkçe'ye özgü noktasız "ı" harfi içeren bir
ürün — tam adı: "Турецкий кофе Kurukahveci Nuri Toplar со вкусом фундука, молотый, жестяная банка,
250 г") açılınca "This page could not be found" (404) hatası veriyor.

**Kullanıcının ilk tahmini (YANLIŞ çıktı):** "Sonradan fiyat girilen, yeni panelden gelen ürünlerde
oluyor" — ama bu ürünün de alış fiyatı (`costPrice`) boş, yine de 404 veriyor. Yani fiyatla ilgisi yok.

**Benim bulduğum ipucu (doğrulanmadı, sadece hipotez):** Ürün linkleri kod içinde tutarsız
oluşturuluyor — bazı yerler `encodeURIComponent(offerId)` kullanıyor, bazıları kullanmıyor:
- KULLANMIYOR: `app/products/page.tsx:40`, `app/orders/[postingNumber]/page.tsx:228`
- KULLANIYOR: `app/analitik/AnalyticsView.tsx:268`, `app/pnl/CostPriceCell.tsx:26`

Doğrudan `getProduct('nuritoplar250fındık')` çağrısı (DB sorgusu) doğru çalışıyor — yani sorun DB
tarafında değil, muhtemelen tarayıcı → Next.js yönlendirme/route eşleştirme katmanında. Kesin kök
neden bulunamadı; `encodeURIComponent` tutarsızlığı ilk şüpheli ama doğrulanmadı.

**Sonraki adım:** `app/products/[offerId]/page.tsx`'e (ya da bir API route'a) geçici bir log
eklenip gerçek tarayıcıdan tıklanarak (ya da kimlik doğrulamalı bir `curl` ile) hangi `offerId`
değerinin route'a ulaştığı görülmeli — beklenen "nuritoplar250fındık" ile GERÇEKTEN gelen değer
karşılaştırılmalı.

## 3. Ozon "Topla" (paketleme onayı + gerekirse bölme) akışı (YAPILMADI, KAPSAMLI BİR ÖZELLİK)

**İstek:** Ozon panelinde, bir sipariş "awaiting_packaging" durumundayken "Topla" dendiğinde
paketleme onaylanıyor ve (ör. ağırlık yanlış girildiyse) siparişi birden fazla kutuya/gönderiye
bölme seçeneği çıkıyor. Kullanıcı bunun bizim sistemimizden de yapılabilmesini istiyor.

**Mevcut durum:** Sistemde bu akış HİÇ YOK — şu an sadece siparişleri okuyup gösteriyoruz ve
(Paraşüt'te) fatura kesiyoruz, Ozon'a sevkiyat/paketleme onayı gibi GERÇEK bir yazma isteği hiç
göndermiyoruz.

**Araştırılan API uçları (WebSearch ile, resmi Ozon dokümantasyonundan):**
- `/v3/posting/multiboxqty/set` — bir gönderi için kutu sayısını ayarlamak için.
- `/v3/posting/fbs/get` ve `/v3/posting/fbs/list` — `is_multibox` / `multi_box_qty` alanlarını
  döndürüyor (bir siparişin bölünüp bölünmediğini görmek için).
- Muhtemelen paketleme onayı için `/v3/posting/fbs/ship` (doğrulanmadı, tam istek gövdesi
  araştırılmadı).

**Neden yapılmadı:** Bu, sistemde OLMAYAN yeni bir yetki sınıfı — Ozon'a gerçek sevkiyat/paketleme
onayı göndermek. Yanlış yapılırsa (yanlış kutu sayısı, yanlış ürün eşleştirmesi vb.) gerçek bir
siparişin sevkiyat sürecini bozabilir. Kullanıcı bunun ayrı, dikkatli bir oturumda ele alınmasını
istedi ("uzun sürecek", "ben ilerde yaparım").

**Sonraki adım (bir sonraki oturumda):**
1. Ozon'un resmi `/v3/posting/fbs/ship` (ya da güncel karşılığı) dokümantasyonu tam olarak
   okunmalı — istenen alanlar (ürün/miktar eşleştirmesi, paket bilgisi vb.).
2. Önce SADECE tek kutulu (bölmesiz) paketleme onayını tek bir sipariş üzerinde, kullanıcı
   onayıyla test etmek en güvenli başlangıç noktası olur.
3. Bölme (multi-box) özelliği ancak temel akış gerçek bir siparişte doğrulandıktan sonra eklenmeli.
