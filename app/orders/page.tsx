import Link from "next/link";
import {
  listOrders,
  computeOrderAmount,
  computeOrderEstimatedProfit,
  getOrderFilterCounts,
  findSearchMatchingOrderIds,
  getShipmentDelayInfo,
  getWeightSplitWarning,
  orderTotalQuantity,
} from "@/modules/orders/orders.service";
import { getRealShippingAndFeesUsdByPosting } from "@/modules/finance/pnl-report.service";
import { getUsdToTryRate } from "@/pricing/fx-rate";
import { getIstanbulTodayRangeUtc } from "@/utils/istanbulTime";
import { parsePageParam } from "@/utils/pagination";
import { OrdersToolbar } from "./OrdersToolbar";
import { OrdersSearchBar } from "./OrdersSearchBar";
import { PageLinkPagination } from "./PageLinkPagination";
import { ParasutInvoiceButton } from "./ParasutInvoiceButton";
import { InvoicedTodayZipButton } from "./InvoicedTodayZipButton";
import { translateOrderStatus } from "@/utils/orderStatus";
import { BulkShipProvider } from "./BulkShipContext";
import { BulkShipBar } from "./BulkShipBar";
import { BulkCheckbox } from "./BulkCheckbox";
import { WEIGHT_WARNING_TEXT } from "./weightWarningText";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  "awaiting_packaging",
  "awaiting_deliver",
  "delivering",
  "delivered",
  "cancelled",
];

function formatMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTl(n: number) {
  return `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Gerçek Paraşüt faturasıyla BİREBİR eşleşmesi için, o faturanın kendi hesaplama sırasını birebir
// tekrarlıyoruz (bkz. src/parasut/orderInvoice.ts: her kalem ÖNCE kendi birim fiyatı TL'ye çevrilip
// 2 ondalığa yuvarlanıyor, SONRA adetle çarpılıp toplanıyor) — tek seferde
// "toplam $ tutar × kur" yapmak, kalem başına yuvarlamadan dolayı birkaç kuruş farklı çıkabilirdi
// (2026-09-10'da code review'da tespit edildi: "birebir aynı" diyen ipucu metniyle çelişirdi).
function computeInvoiceTlAmount(items: Array<{ price: string; quantity: number }>, rate: number): number {
  return items.reduce((sum, item) => {
    const unitPriceTry = Number((Number(item.price) * rate).toFixed(2));
    return sum + unitPriceTry * item.quantity;
  }, 0);
}

function getShipmentDate(rawPayload: unknown): string | null {
  const date = (rawPayload as { shipment_date?: string } | null)?.shipment_date;
  return date ?? null;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; invoicedToday?: string; delayed?: string; q?: string }>;
}) {
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const showInvoicedToday = params.invoicedToday === "1";
  const showDelayed = params.delayed === "1";
  const todayRange = getIstanbulTodayRangeUtc();
  // getUsdToTryRate() matchingIds'e bağlı değil — arama sorgusunu (pahalı ILIKE) beklemeden hemen
  // paralel başlatılıyor (2026-09-10'da code review'da tespit edildi — daha önce matchingIds'in
  // bitmesini gereksiz yere bekliyordu).
  const liveTryRatePromise = getUsdToTryRate();
  const matchingIds = params.q?.trim() ? await findSearchMatchingOrderIds(params.q) : null;

  // Faturası kesilmemiş (ya da bu sütun eklenmeden önce kesilmiş) siparişlerde tahmini bir TL
  // değeri gösterebilmek için günün canlı kurunu da çekiyoruz — kesin kurla ("gerçek fatura kuru")
  // karışmasın diye UI'da ayrı etiketlendiriliyor (bkz. BEKLEYEN-GELISTIRMELER.md #1, 2026-09-10,
  // kullanıcı talebi). filterCounts ve liveTryRate, orders sonucuna bağlı değil — bu yüzden
  // listOrders ile birlikte paralel başlatılıyor, sadece kargo maliyeti orders'ı bekliyor
  // (2026-09-10'da code review'da tespit edildi — filterCounts listOrders'ı gereksiz yere
  // sırayla bekliyordu).
  const listOrdersPromise = listOrders({
    status: showInvoicedToday || showDelayed ? undefined : params.status,
    invoicedSince: showInvoicedToday ? todayRange.start : undefined,
    invoicedTo: showInvoicedToday ? todayRange.end : undefined,
    delayedOnly: showDelayed,
    matchingIds,
    skip: (page - 1) * 50,
    take: 50,
  });
  // "Gecikenler" sekmesi aktifken listOrders'ın kendi delayedOnly dalı zaten AYNI matchingIds ile
  // tüm gecikmiş siparişleri taramış oluyor (total = doğru sayı) — bu durumda getOrderFilterCounts'ın
  // kendi (aynı pahalı) taramayı TEKRAR yapmasını önlemek için önce listOrders'ı bekleyip sayıyı ona
  // devrediyoruz; showDelayed false iken hâlâ tam paralel çalışıyor (2026-09-11'de code review'da
  // tespit edildi: iki fonksiyon paralel çalıştığı için birbirinin sonucunu göremiyordu).
  let orders: Awaited<typeof listOrdersPromise>["orders"];
  let total: number;
  let liveTryRate: Awaited<typeof liveTryRatePromise>;
  let filterCounts: Awaited<ReturnType<typeof getOrderFilterCounts>>;
  if (showDelayed) {
    const listResult = await listOrdersPromise;
    orders = listResult.orders;
    total = listResult.total;
    [liveTryRate, filterCounts] = await Promise.all([
      liveTryRatePromise,
      getOrderFilterCounts({
        matchingIds,
        invoicedSince: todayRange.start,
        invoicedTo: todayRange.end,
        knownDelayedCount: total,
      }),
    ]);
  } else {
    const listResult = await Promise.all([
      listOrdersPromise,
      liveTryRatePromise,
      getOrderFilterCounts({ matchingIds, invoicedSince: todayRange.start, invoicedTo: todayRange.end }),
    ]);
    orders = listResult[0].orders;
    total = listResult[0].total;
    liveTryRate = listResult[1];
    filterCounts = listResult[2];
  }
  const { shipping: realShippingByPosting, fees: realFeesByPosting } = await getRealShippingAndFeesUsdByPosting(
    orders.map((o) => o.postingNumber),
  );

  // Sayfalama linkleri (pageQueryPrefix) ve filtre butonu linkleri (filterHref) aynı üç parametreyi
  // (status/invoicedToday/q) tek bir yerden üretiyor — daha önce ikisi ayrı ayrı elle yazılmıştı
  // (2026-09-10'da code review'da tespit edildi: iki yerde aynı mantığın tekrarlanması, yeni bir
  // filtre eklendiğinde birinin unutulma riskini taşıyordu).
  function ordersQuery(overrides: { status?: string; invoicedToday?: string; delayed?: string } = {}) {
    const qs = new URLSearchParams(overrides);
    if (params.q) qs.set("q", params.q);
    return qs.toString();
  }

  // Filtre butonlarının sayaçları aktif aramaya göre hesaplandığı için (getOrderFilterCounts),
  // linkler de aramayı korumalı — aksi halde kullanıcı "iphone" aratıp "Teslim Edildi (2)" görüp
  // tıkladığında arama sıfırlanır ve gördüğü sayı ile indiği liste birbirini tutmazdı (2026-09-10'da
  // code review'da tespit edildi).
  function filterHref(overrides: { status?: string; invoicedToday?: string; delayed?: string }) {
    const s = ordersQuery(overrides);
    return s ? `/orders?${s}` : "/orders";
  }

  const currentQuery = ordersQuery({
    ...(params.status ? { status: params.status } : {}),
    ...(showInvoicedToday ? { invoicedToday: "1" } : {}),
    ...(showDelayed ? { delayed: "1" } : {}),
  });
  const pageQueryPrefix = currentQuery ? `${currentQuery}&` : "";
  // Filtre/arama/sayfa DEĞİŞTİĞİNDE toplu paketleme seçimi (BulkShipProvider'ın içindeki state)
  // SIFIRLANMALI — aksi halde kullanıcı bir filtrede birkaç sipariş seçip başka bir sekmeye/sayfaya
  // geçtiğinde, artık ekranda hiç görünmeyen o eski seçimler sessizce seçili kalır ve "Toplu
  // Paketle" dendiğinde GERÇEK, geri alınamaz Ozon istekleri kullanıcının o an görmediği siparişlere
  // de gider (2026-09-11'de code review'da tespit edildi: aynı /orders rotası içindeki client-side
  // gezinmede React, aynı ağaç konumundaki BulkShipProvider'ı yeniden BAĞLAMIYOR, state korunuyordu).
  // React'e "bu farklı bir görünüm" dedirtmenin standart yolu key değiştirmek — bu, provider'ı
  // TAMAMEN yeniden bağlar (remount) ve state'i sıfırlar.
  const selectionKey = `${currentQuery}|page=${page}`;

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Siparişler</h1>
        <OrdersToolbar />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <OrdersSearchBar />
      </div>

      <BulkShipProvider key={selectionKey}>
      <BulkShipBar />
      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Link href={filterHref({})}>
          <button className={`btn-secondary${!params.status && !showInvoicedToday && !showDelayed ? " active" : ""}`}>
            Tümü <span className="hint">({filterCounts.total})</span>
          </button>
        </Link>
        {STATUS_OPTIONS.map((s) => (
          <Link key={s} href={filterHref({ status: s })}>
            {/* !showDelayed BİLEREK eklendi — delayed=1 aktifken listOrders status/invoicedToday'i
                TAMAMEN yok sayıyor (bkz. yukarıdaki listOrders çağrısı), o yüzden URL'de ikisi
                birlikte varsa (ör. ?delayed=1&status=delivered) sadece "Gecikenler" aktif
                görünmeli, aksi halde iki buton aynı anda "aktif" görünüp gerçek filtreyle
                çelişirdi (2026-09-11'de code review'da tespit edildi). */}
            <button className={`btn-secondary${params.status === s && !showDelayed ? " active" : ""}`}>
              {translateOrderStatus(s)} <span className="hint">({filterCounts.byStatus[s] ?? 0})</span>
            </button>
          </Link>
        ))}
        <Link href={filterHref({ invoicedToday: "1" })}>
          <button className={`btn-secondary${showInvoicedToday && !showDelayed ? " active" : ""}`}>
            Bugün Faturası Kesilenler <span className="hint">({filterCounts.invoicedToday})</span>
          </button>
        </Link>
        <Link href={filterHref({ delayed: "1" })}>
          <button
            className={`btn-secondary${showDelayed ? " active" : ""}`}
            title="Ozon'un kargoya verme süresi geçmiş ama hâlâ kargoya teslim edilmemiş siparişler (durumdan bağımsız)"
          >
            Gecikenler{" "}
            <span className="hint" style={{ color: filterCounts.delayedCount > 0 ? "var(--danger)" : undefined }}>
              ({filterCounts.delayedCount})
            </span>
          </button>
        </Link>
        {showInvoicedToday && <InvoicedTodayZipButton />}
      </div>

      <div className="card">
        {orders.length === 0 ? (
          <div className="empty-state">
            {params.q
              ? `"${params.q}" için sonuç bulunamadı.`
              : "Henüz sipariş yok. \"Senkronize Et\" ile Ozon'dan sipariş çekin (ilk çalıştırmada cron da otomatik çalışıyor, birkaç dakika sürebilir)."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ whiteSpace: "nowrap" }} title="Toplu paketleme için seçim — sadece 'Paketleme Bekliyor' durumundaki siparişlerde çıkar">Seç</th>
                <th style={{ whiteSpace: "nowrap" }}>Posting No</th>
                <th style={{ whiteSpace: "nowrap" }}>Durum</th>
                <th style={{ whiteSpace: "nowrap" }}>Kabul Tarihi</th>
                <th style={{ whiteSpace: "nowrap" }}>Kargo Tarihi</th>
                <th style={{ whiteSpace: "nowrap" }}>Ürün</th>
                <th style={{ whiteSpace: "nowrap" }}>Tutar</th>
                <th style={{ whiteSpace: "nowrap" }} title="Fatura kesilmiş siparişlerde o günün gerçek faturasıyla birebir aynı, kesin tutar. Kesilmemişlerde bugünün canlı kuruyla hesaplanan tahmini değer.">
                  TL Satış Fiyatı
                </th>
                <th style={{ whiteSpace: "nowrap" }} title="Satış tutarı - alış maliyeti - kargo - komisyon/lojistik/banka bedeli. Ozon bu kesintileri gerçekten işlediyse (genelde teslimattan sonra) gerçek tutarlar, işlemediyse tahmini değerler kullanılır.">
                  Olası Net Kâr
                </th>
                <th style={{ whiteSpace: "nowrap" }}>Fatura</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const shipmentDate = getShipmentDate(o.rawPayload);
                const delay = getShipmentDelayInfo(o);
                const canBulkShip = o.status === "awaiting_packaging" && o.shipClaimedAt == null;
                const weightWarning = getWeightSplitWarning(o);
                const totalQuantity = orderTotalQuantity(o.items);
                return (
                  <tr key={o.id}>
                    <td>
                      {canBulkShip && (
                        <BulkCheckbox postingNumber={o.postingNumber} totalQuantity={totalQuantity} weightWarning={weightWarning} />
                      )}
                    </td>
                    <td>
                      <Link href={`/orders/${o.postingNumber}`}>{o.postingNumber}</Link>
                      <div className="hint">{o.scheme}</div>
                      {weightWarning && (
                        <div className="hint" style={{ color: "var(--danger)" }}>
                          {WEIGHT_WARNING_TEXT}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge pending">{translateOrderStatus(o.status)}</span>
                    </td>
                    <td>{o.orderDate ? new Date(o.orderDate).toLocaleString("tr-TR") : "-"}</td>
                    <td>
                      {shipmentDate ? new Date(shipmentDate).toLocaleDateString("tr-TR") : "-"}
                      {delay.isDelayed && (
                        <div className="hint" style={{ color: "var(--danger)" }}>
                          {delay.daysLate === 0 ? "bugün gecikti" : `${delay.daysLate} gün gecikti`}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {o.items.map((item) => (
                          <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {item.product?.images && Array.isArray(item.product.images) && (item.product.images as string[])[0] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={(item.product.images as string[])[0]}
                                alt=""
                                width={40}
                                height={40}
                                className="zoom-thumb-5x"
                                style={{ objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", flexShrink: 0 }}
                              />
                            ) : (
                              <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--border)", flexShrink: 0 }} />
                            )}
                            <div>
                              <div>{item.quantity} adet, {item.offerId} — {formatMoney(Number(item.price))}</div>
                              <div className="hint">
                                {item.product?.name ?? "-"}
                                {item.product?.costPrice && (
                                  <> · alış {formatMoney(Number(item.product.costPrice))}</>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>{formatMoney(computeOrderAmount(o.items))}</td>
                    <td>
                      {(() => {
                        if (o.parasutInvoiceFxRate != null) {
                          return (
                            <span title="Fatura kesildiği günün gerçek kuruyla — Paraşüt faturasındaki tutarla birebir aynı">
                              {formatTl(computeInvoiceTlAmount(o.items, o.parasutInvoiceFxRate))}
                            </span>
                          );
                        }
                        const amountUsd = computeOrderAmount(o.items);
                        if (liveTryRate != null) {
                          return (
                            <span className="hint" title="Henüz fatura kesilmedi — bugünün canlı kuruyla TAHMİNİ değer, fatura kesildiğinde kesinleşecek">
                              ~{formatTl(amountUsd * liveTryRate)}
                            </span>
                          );
                        }
                        return <span className="hint">-</span>;
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const profit = computeOrderEstimatedProfit(
                          o.items,
                          realShippingByPosting.get(o.postingNumber),
                          realFeesByPosting.get(o.postingNumber),
                        );
                        if (profit == null) return <span className="hint">veri yok</span>;
                        return (
                          <span style={{ color: profit >= 0 ? "var(--success)" : "var(--danger)" }}>
                            {formatMoney(profit)}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      <ParasutInvoiceButton
                        postingNumber={o.postingNumber}
                        initialInvoiceNo={o.parasutInvoiceNo}
                        initialPrintUrl={o.parasutPrintUrl}
                        initialConfirmed={o.parasutInvoiceNoConfirmed}
                        initialPdfCached={o.parasutInvoicePdfCached}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {total > 50 && (
          <PageLinkPagination
            page={page}
            totalPages={Math.ceil(total / 50)}
            hrefForPage={(p) => `/orders?${pageQueryPrefix}page=${p}`}
          />
        )}
      </div>
      </BulkShipProvider>
    </div>
  );
}
