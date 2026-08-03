import Link from "next/link";
import { listOrders, computeOrderAmount } from "@/modules/orders/orders.service";
import { getPnlSummary } from "@/modules/finance/finance.service";
import { OrdersToolbar } from "./OrdersToolbar";

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
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? "1");
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [{ orders, total }, pnl] = await Promise.all([
    listOrders({ status: params.status, skip: (page - 1) * 50, take: 50 }),
    getPnlSummary({ since }),
  ]);

  const hasSettledData = pnl.byOperationType.some(
    (t) => !/redistribution|acquiring/i.test(t.operationType),
  );

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Siparişler</h1>
        <OrdersToolbar />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Son 30 Gün PNL (Ozon finans işlemleri)</h3>
        {!hasSettledData && (
          <div className="hint" style={{ marginBottom: 16, color: "var(--muted)" }}>
            Ozon, komisyon/kargo/diğer kesintileri sipariş <strong>teslim edildikten</strong> sonra
            muhasebeleştiriyor. Henüz teslim edilmiş/kesinleşmiş bir işlem yok — aşağıdaki tutar
            sadece ödeme altyapısının küçük düzeltme işlemlerini (aşağıdaki dökümde görülür)
            yansıtıyor, gerçek satış/komisyon verisi değil.
          </div>
        )}
        <div className="summary-grid" style={{ marginBottom: 16 }}>
          <div>
            <div className="hint">Toplam Tutar</div>
            <div className="value">{formatMoney(pnl.amount)}</div>
          </div>
          <div>
            <div className="hint">Komisyon</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatMoney(pnl.commission)}</div>
          </div>
          <div>
            <div className="hint">Kargo</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatMoney(pnl.delivery)}</div>
          </div>
          <div>
            <div className="hint">Diğer Kesintiler</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatMoney(pnl.other)}</div>
          </div>
          <div>
            <div className="hint">Net</div>
            <div className="value" style={{ color: "var(--success)" }}>{formatMoney(pnl.net)}</div>
          </div>
        </div>
        {pnl.byOperationType.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>İşlem Tipi</th>
                <th>Adet</th>
                <th>Toplam Tutar</th>
              </tr>
            </thead>
            <tbody>
              {pnl.byOperationType.map((t) => (
                <tr key={t.operationType}>
                  <td>{t.operationType}</td>
                  <td>{t.count}</td>
                  <td>{formatMoney(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/orders">
          <button className={`btn-secondary${!params.status ? " active" : ""}`}>Tümü</button>
        </Link>
        {STATUS_OPTIONS.map((s) => (
          <Link key={s} href={`/orders?status=${s}`}>
            <button className={`btn-secondary${params.status === s ? " active" : ""}`}>{s}</button>
          </Link>
        ))}
      </div>

      <div className="card">
        {orders.length === 0 ? (
          <div className="empty-state">
            Henüz sipariş yok. "Senkronize Et" ile Ozon'dan sipariş çekin (ilk çalıştırmada cron da otomatik çalışıyor, birkaç dakika sürebilir).
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
                              <div className="hint">{item.product?.name ?? "-"}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>{formatMoney(computeOrderAmount(o.items))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {total > 50 && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {page > 1 && (
              <Link href={`/orders?${params.status ? `status=${params.status}&` : ""}page=${page - 1}`}>
                <button className="btn-secondary">Önceki</button>
              </Link>
            )}
            {page * 50 < total && (
              <Link href={`/orders?${params.status ? `status=${params.status}&` : ""}page=${page + 1}`}>
                <button className="btn-secondary">Sonraki</button>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
