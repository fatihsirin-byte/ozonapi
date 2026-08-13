import Link from "next/link";
import { listOrders, computeOrderAmount, computeOrderCost } from "@/modules/orders/orders.service";
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

// Ozon'un finans/işlem API'si (PNL kartı) tutarları RUB cinsinden dönüyor, hesabın sözleşme para
// birimi USD olsa da (2026-08-14'te Ozon'un kendi panelindeki "-360 ₽" değeriyle karşılaştırılıp
// doğrulandı — sistemimiz bunu yanlışlıkla "-$360" gösteriyordu, ~80x büyütülmüş görünüyordu).
function formatRub(n: number) {
  return `₽${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  const [{ orders, total }, pnl, { orders: recentOrders }] = await Promise.all([
    listOrders({ status: params.status, skip: (page - 1) * 50, take: 50 }),
    getPnlSummary({ since }),
    listOrders({ since, take: 1000 }),
  ]);

  const grossRevenue = recentOrders.reduce((sum, o) => sum + computeOrderAmount(o.items), 0);
  const costs = recentOrders.map((o) => computeOrderCost(o.items));
  const grossCost = costs.reduce((sum: number, c) => sum + (c ?? 0), 0);
  const missingCostCount = costs.filter((c) => c == null).length;

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
        <h3 style={{ marginTop: 0 }}>Son 30 Gün Brüt Kâr (ürün bazlı — komisyon/kargo kesintisi hariç)</h3>
        <div className="hint" style={{ marginBottom: 16 }}>
          Bu kâr sipariş anında hesaplanıyor, Ozon'un komisyon/kargo muhasebeleştirmesini
          beklemiyor — alış fiyatı × adet, satış tutarından düşülüyor.
          {missingCostCount > 0 && ` ${missingCostCount} siparişte alış fiyatı eksik, hesaba dahil edilmedi.`}
        </div>
        <div className="summary-grid">
          <div>
            <div className="hint">Satış Tutarı</div>
            <div className="value">{formatMoney(grossRevenue)}</div>
          </div>
          <div>
            <div className="hint">Alış Maliyeti</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatMoney(grossCost)}</div>
          </div>
          <div>
            <div className="hint">Brüt Kâr</div>
            <div className="value" style={{ color: "var(--success)" }}>{formatMoney(grossRevenue - grossCost)}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Son 30 Gün PNL (Ozon finans işlemleri)</h3>
        <div className="hint" style={{ marginBottom: 16 }}>
          Bu kart Ozon'un finans/işlem verisinden geliyor ve <strong>₽ (RUB)</strong> cinsinden — yukarıdaki
          "Brüt Kâr" kartıyla (bizim kendi USD fiyatımız) karıştırılmasın.
        </div>
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
            <div className="value">{formatRub(pnl.amount)}</div>
          </div>
          <div>
            <div className="hint">Komisyon</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatRub(pnl.commission)}</div>
          </div>
          <div>
            <div className="hint">Kargo</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatRub(pnl.delivery)}</div>
          </div>
          <div>
            <div className="hint">Diğer Kesintiler</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatRub(pnl.other)}</div>
          </div>
          <div>
            <div className="hint">Net</div>
            <div className="value" style={{ color: pnl.net >= 0 ? "var(--success)" : "var(--danger)" }}>
              {formatRub(pnl.net)}
            </div>
          </div>
        </div>
        {pnl.byOperationType.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>İşlem Tipi</th>
                <th>Adet</th>
                <th>Toplam Tutar (₽)</th>
              </tr>
            </thead>
            <tbody>
              {pnl.byOperationType.map((t) => (
                <tr key={t.operationType}>
                  <td>{t.operationType}</td>
                  <td>{t.count}</td>
                  <td>{formatRub(t.amount)}</td>
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
                <th style={{ whiteSpace: "nowrap" }} title="Satış tutarı - alış maliyeti (Ozon komisyon/kargo kesintileri hariç)">
                  Brüt Kâr
                </th>
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
                        const cost = computeOrderCost(o.items);
                        if (cost == null) return <span className="hint">alış fiyatı yok</span>;
                        return formatMoney(computeOrderAmount(o.items) - cost);
                      })()}
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
