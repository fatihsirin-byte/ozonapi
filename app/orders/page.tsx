import Link from "next/link";
import { listOrders, computeOrderAmount, computeOrderEstimatedProfit } from "@/modules/orders/orders.service";
import { getRealShippingUsdByPosting } from "@/modules/finance/pnl-report.service";
import { getIstanbulTodayRangeUtc } from "@/utils/istanbulTime";
import { OrdersToolbar } from "./OrdersToolbar";
import { OrdersSearchBar } from "./OrdersSearchBar";
import { ParasutInvoiceButton } from "./ParasutInvoiceButton";
import { InvoicedTodayZipButton } from "./InvoicedTodayZipButton";

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

function getShipmentDate(rawPayload: unknown): string | null {
  const date = (rawPayload as { shipment_date?: string } | null)?.shipment_date;
  return date ?? null;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; invoicedToday?: string; q?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? "1");
  const showInvoicedToday = params.invoicedToday === "1";
  const todayRange = getIstanbulTodayRangeUtc();

  const { orders, total } = await listOrders({
    status: showInvoicedToday ? undefined : params.status,
    invoicedSince: showInvoicedToday ? todayRange.start : undefined,
    invoicedTo: showInvoicedToday ? todayRange.end : undefined,
    search: params.q,
    skip: (page - 1) * 50,
    take: 50,
  });
  const realShippingByPosting = await getRealShippingUsdByPosting(orders.map((o) => o.postingNumber));

  const pageQuery = new URLSearchParams();
  if (params.status) pageQuery.set("status", params.status);
  if (params.q) pageQuery.set("q", params.q);
  if (showInvoicedToday) pageQuery.set("invoicedToday", "1");
  const pageQueryPrefix = pageQuery.toString() ? `${pageQuery.toString()}&` : "";

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Siparişler</h1>
        <OrdersToolbar />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <OrdersSearchBar />
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/orders">
          <button className={`btn-secondary${!params.status && !showInvoicedToday ? " active" : ""}`}>Tümü</button>
        </Link>
        {STATUS_OPTIONS.map((s) => (
          <Link key={s} href={`/orders?status=${s}`}>
            <button className={`btn-secondary${params.status === s ? " active" : ""}`}>{s}</button>
          </Link>
        ))}
        <Link href="/orders?invoicedToday=1">
          <button className={`btn-secondary${showInvoicedToday ? " active" : ""}`}>Bugün Faturası Kesilenler</button>
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
                <th style={{ whiteSpace: "nowrap" }}>Posting No</th>
                <th style={{ whiteSpace: "nowrap" }}>Durum</th>
                <th style={{ whiteSpace: "nowrap" }}>Kabul Tarihi</th>
                <th style={{ whiteSpace: "nowrap" }}>Kargo Tarihi</th>
                <th style={{ whiteSpace: "nowrap" }}>Ürün</th>
                <th style={{ whiteSpace: "nowrap" }}>Tutar</th>
                <th style={{ whiteSpace: "nowrap" }} title="Satış tutarı - alış maliyeti - tahmini kargo (ağırlıktan) - tahmini Ozon komisyonu/lojistik/banka bedeli">
                  Olası Net Kâr
                </th>
                <th style={{ whiteSpace: "nowrap" }}>Fatura</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const shipmentDate = getShipmentDate(o.rawPayload);
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.postingNumber}`}>{o.postingNumber}</Link>
                      <div className="hint">{o.scheme}</div>
                    </td>
                    <td>
                      <span className="badge pending">{o.status}</span>
                    </td>
                    <td>{o.orderDate ? new Date(o.orderDate).toLocaleString("tr-TR") : "-"}</td>
                    <td>{shipmentDate ? new Date(shipmentDate).toLocaleDateString("tr-TR") : "-"}</td>
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
                        const profit = computeOrderEstimatedProfit(o.items, realShippingByPosting.get(o.postingNumber));
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
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {total > 50 && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {page > 1 && (
              <Link href={`/orders?${pageQueryPrefix}page=${page - 1}`}>
                <button className="btn-secondary">Önceki</button>
              </Link>
            )}
            {page * 50 < total && (
              <Link href={`/orders?${pageQueryPrefix}page=${page + 1}`}>
                <button className="btn-secondary">Sonraki</button>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
