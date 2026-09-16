import { prisma } from "../db/prisma";
import { getCustomDeclarationDetailsByCodeList, getCancelledShipmentsByDateRange, getMeasurementsByCodeList } from "./client";
import { toIstanbulDateString } from "../utils/istanbulTime";
import { aseDeclarationPendingWhere } from "../modules/orders/orders.service";

// ASE gümrük beyanı / iptal / ölçüm durumunu periyodik olarak kontrol eder (bkz.
// sync-orders-cron.ts). 2026-09-16'da kullanıcının ASE'deki temsilcisi Devrim Eriş ile yaptığı
// görüşme sonrası eklendi: "bir kere iptal olursa ya da bi kere beyanname çıkarsa bi daha
// sorgulamaya gerek yok ... ayrıca bu durumu ve beyanname numarasını sipariş kartının içine
// ekleyelim, siparişler sayfasında ase iptal diye durum belirtelim". Bu SADECE OKUMA yapan bir
// sorgu — ASE'ye hiçbir gerçek/geri alınamaz bildirim GÖNDERMEZ, o yüzden (sendOrderToAse'in
// aksine) elle değil otomatik/periyodik çalışması güvenlidir.

const BATCH_SIZE = 50; // ASE doküman limiti: bir kerede en fazla 50 kod.
const CANCELLATION_LOOKBACK_DAYS = 30; // GetCancelledShipmentsByDateRange en fazla 1 aylık aralık kabul ediyor.
const BETWEEN_REQUESTS_MS = 350; // Doküman: "İki istek arasında en az 300 ms olmalıdır."

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ASE "YYYY-MM-DD" ya da "YYYY-MM-DD HH:mm:ss" formatında string veriyor — hangi saat dilimine
// göre olduğu dokümanda belirtilmemiş, GetToken'daki ExpriesDate'te olduğu gibi (bkz. client.ts
// parseAseExpiresDate) sadece "hangi gün" bilgisi asıl önemli olduğundan birkaç saatlik fark
// önemli değil.
// `value` normalizeItemFields'tan (client.ts) geliyor — istenen alan ASE yanıtında ne camelCase
// ne PascalCase olarak bulunursa `undefined` dönebilir, bu yüzden burada null/undefined'ı en
// başta eleyip `.match` çağırmadan önce güvenli hale getiriyoruz (2026-09-16, üçüncü code review
// turunda tespit edildi: bir önceki düzeltme `&&` koruyucusunu kaldırınca bu durumu
// TypeError'a çevirmişti — hata yakalansa bile o poll turundaki KALAN kayıtları işlemeden loop'u
// kesiyordu).
function parseAseDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

// Bir DB güncellemesi başarısız olursa (ör. geçici bağlantı sorunu) sadece O SATIRI atlayıp
// devam ediyoruz — aksi halde ağ çağrısı tamamen başarılı olsa bile listedeki 2. öğede DB hatası
// çıkarsa 3., 4., 5. öğeler hiç işlenmeden loop biterdi VE hata yanlışlıkla "ASE sorgusu
// başarısız" gibi loglanırdı (2026-09-16 code review'da tespit edildi).
async function safeUpdateOrder(postingNumber: string, data: Parameters<typeof prisma.order.update>[0]["data"]): Promise<void> {
  try {
    await prisma.order.update({ where: { postingNumber }, data });
  } catch (err) {
    console.error(`[ase] Order güncellenemedi (posting ${postingNumber}):`, err);
  }
}

// Aynı anda iki poll turunun üst üste binmesini engelliyor — ilk kurulumda (ya da uzun bir kesinti
// sonrası) ASE'ye daha önce başarıyla gönderilmiş TÜM siparişler aynı anda "bekleyen" duruma
// düşebilir; büyük bir liste 15 dakikalık cron aralığından uzun sürerse bir sonraki tur üzerine
// binip istek sıklığını iki katına çıkarıp ASE'nin hız sınırına (60 saniyede 200 istek) takılma
// riskini artırırdı (2026-09-16 code review'da tespit edildi).
let isRunning = false;

export async function pollAseShipmentStatuses(): Promise<void> {
  if (isRunning) {
    console.log("[ase] Önceki durum sorgusu turu hâlâ sürüyor, bu tur atlanıyor.");
    return;
  }
  isRunning = true;
  try {
    await doPollAseShipmentStatuses();
  } finally {
    isRunning = false;
  }
}

async function doPollAseShipmentStatuses(): Promise<void> {
  // Kargoya verilmiş/teslim edilmiş VE henüz "kesin" bir sonuca (iptal ya da beyanname) ulaşmamış
  // TÜM siparişler sorgulanır — bizim panelimizin "ASE'ye Gönder" butonuyla BAŞARIYLA gönderdiğini
  // bildiği (aseShipmentSuccess=true) siparişlerle SINIRLI DEĞİL (2026-09-16, kullanıcı talebi:
  // "her şey her sipariş aseyle gitti hepsini sorabilirsin ... geçmişteki aseyle gönder
  // demediklerimizi de sorgula") — geçmişte bu özellik yokken ya da buton hiç kullanılmadan
  // kargoya verilmiş siparişler de dahil.
  const pending = await prisma.order.findMany({
    where: aseDeclarationPendingWhere(),
    select: { postingNumber: true },
  });
  if (pending.length === 0) return;

  let codes = pending.map((o) => o.postingNumber);

  // 1) İptal kontrolü — tek bir çağrı, KOD LİSTESİ değil TARİH ARALIĞI bazlı (ASE'de bu servisin
  // sadece bu şekli var). Tarih aralığı TSİ'ye göre hesaplanıyor (bkz. toIstanbulDateString) —
  // UTC kullanılsaydı gece yarısından sonraki ~3 saatlik pencerede "bugün" bir gün geride kalırdı
  // (2026-09-16 code review'da tespit edildi). Dönen sonuçlardan bizim bekleyen listemizle
  // eşleşenleri işliyoruz.
  try {
    const now = new Date();
    const begin = new Date(now.getTime() - CANCELLATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const cancelled = await getCancelledShipmentsByDateRange(toIstanbulDateString(begin), toIstanbulDateString(now));
    const pendingCodes = new Set(codes);
    const cancelledCodes = new Set<string>();
    for (const c of cancelled) {
      if (!pendingCodes.has(c.code)) continue;
      cancelledCodes.add(c.code);
      // parseAseDateTime zaten eşleşmeyen/boş bir girdide null döner — "" gibi boş ama null
      // OLMAYAN bir değer burada `&&` ile kontrol edilseydi (önceki sürüm) `??` onu null saymayıp
      // olduğu gibi (boş string) DB'ye yazmaya çalışırdı, Prisma bunu geçersiz bir DateTime olarak
      // reddeder, hata sessizce loglanır ve sipariş bir daha asla "iptal" olarak işaretlenemezdi
      // (2026-09-16, ikinci code review turunda tespit edildi).
      await safeUpdateOrder(c.code, {
        aseCancelledAt: parseAseDateTime(c.aseCancelRecordedAt) ?? new Date(),
        aseCancelReason: c.detail,
      });
    }
    // Az önce iptal olarak işaretlenenleri aşağıdaki sorgulardan hariç tutuyoruz — kullanıcı
    // talebi: "bir kere iptal olursa ... bir daha sorgulamaya gerek yok". Ayrı bir DB sorgusuyla
    // değil, elimizdeki listeden filtreleyerek (2026-09-16 code review'da "gereksiz ekstra DB
    // sorgusu" bulgusuna karşılık — bu satırlar arasında codes'u başka hiçbir yazan yok).
    codes = codes.filter((code) => !cancelledCodes.has(code));
  } catch (err) {
    console.error("[ase] GetCancelledShipmentsByDateRange sorgusu başarısız:", err);
  }
  await sleep(BETWEEN_REQUESTS_MS);

  for (const batch of chunk(codes, BATCH_SIZE)) {
    // 2) Gümrük beyanı durumu.
    try {
      const details = await getCustomDeclarationDetailsByCodeList(batch);
      // isAvailableCode=false — ASE bu siparişi tanımıyor demektir, normal şartlarda olmamalı
      // (sendOrderToAse ancak ASE'nin gerçekten kabul ettiği bir gönderim için
      // aseShipmentSuccess=true yazıyor). Bilerek sert bir "gate" (atla/continue) YAPMIYORUZ: bu
      // alan doküman dışı, gerçek API'de hiç doğrulanmadı (SendShipment'ta olduğu gibi doküman
      // gerçek yanıtla birebir uyuşmayabilir, bkz. normalizeSendShipmentResponse yorumu) —
      // isAvailableCode yanlış/eksik gelirse bile customDeclarationCode dolu geldiyse yine de
      // kaydedilsin diye (2026-09-16, dördüncü code review turunda tespit edildi). Tek tek her
      // sipariş için ayrı satır LOGLAMIYORUZ — bekleyen büyük bir liste isAvailableCode'u güvenilmez
      // döndürürse her 15 dakikada binlerce tekrarlı log satırı üretip gerçek hataları boğardı
      // (2026-09-16, beşinci code review turunda tespit edildi) — bunun yerine bir ÖZET sayısı.
      const unavailableCount = details.filter((d) => !d.isAvailableCode).length;
      if (unavailableCount > 0) {
        console.error(`[ase] GetCustomDeclarationDetailsByCodeList: ${unavailableCount}/${details.length} kod isAvailableCode=false döndü (beklenmiyordu).`);
      }
      for (const d of details) {
        if (!d.customDeclarationCode) continue; // henüz beyan çıkmamış, yazılacak bir şey yok
        await safeUpdateOrder(d.code, {
          aseCustomDeclarationCode: d.customDeclarationCode,
          aseCustomDeclarationDate: parseAseDateTime(d.customDeclarationDate),
        });
      }
    } catch (err) {
      console.error("[ase] GetCustomDeclarationDetailsByCodeList sorgusu başarısız:", err);
    }
    await sleep(BETWEEN_REQUESTS_MS);

    // 3) Ölçüm (kg) — doküman: sonuçlar onay sürecinden geçtiği için gecikmeli görünebilir, bu
    // yüzden weightKg uzun süre null kalması normal. Sadece dolu bir değer geldiğinde yazıyoruz,
    // bunun için ayrıca "kesin" sayılıp sorgulama durdurulmuyor (kullanıcı sadece iptal/beyanname
    // için durdurulmasını istedi).
    try {
      const measurements = await getMeasurementsByCodeList(batch);
      // Beyanname döngüsündeki AYNI gerekçeyle (yukarıya bkz.) — özet sayı, veri yazımını
      // engellemiyor.
      const unavailableCount = measurements.filter((m) => !m.isAvailableCode).length;
      if (unavailableCount > 0) {
        console.error(`[ase] GetMeasurementsByCodeList: ${unavailableCount}/${measurements.length} kod isAvailableCode=false döndü (beklenmiyordu).`);
      }
      for (const m of measurements) {
        if (m.weightKg == null) continue;
        await safeUpdateOrder(m.code, { aseMeasuredWeightKg: m.weightKg });
      }
    } catch (err) {
      console.error("[ase] GetMeasurementsByCodeList sorgusu başarısız:", err);
    }
    await sleep(BETWEEN_REQUESTS_MS);
  }
}
