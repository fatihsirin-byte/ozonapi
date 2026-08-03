import Link from "next/link";
import { listOrders } from "@/modules/orders/orders.service";
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
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  return (
    <div className="page">
      <div className="topbar">
        <h1>Siparişler</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Link href="/products">
            <button className="btn-secondary">Ürünler</button>
          </Link>
          <OrdersToolbar />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Son 30 Gün PNL (Ozon finans işlemleri)</h3>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div className="hint">Satış Tutarı</div>
            <div style={{ fontSize: 20 }}>{formatMoney(pnl.amount)}</div>
          </div>
          <div>
            <div className="hint">Komisyon</div>
            <div style={{ fontSize: 20, color: "var(--danger)" }}>{formatMoney(pnl.commission)}</div>
          </div>
          <div>
            <div className="hint">Kargo</div>
            <div style={{ fontSize: 20, color: "var(--danger)" }}>{formatMoney(pnl.delivery)}</div>
          </div>
          <div>
            <div className="hint">Diğer Kesintiler</div>
            <div style={{ fontSize: 20, color: "var(--danger)" }}>{formatMoney(pnl.other)}</div>
          </div>
          <div>
            <div className="hint">Net</div>
            <div style={{ fontSize: 20, color: "var(--success)" }}>{formatMoney(pnl.net)}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8 }}>
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
                <th>Posting No</th>
                <th>Tarih</th>
                <th>Durum</th>
                <th>Kalem Sayısı</th>
                <th>Şema</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/orders/${o.postingNumber}`}>{o.postingNumber}</Link>
                  </td>
                  <td>{o.orderDate ? new Date(o.orderDate).toLocaleString("tr-TR") : "-"}</td>
                  <td>
                    <span className="badge pending">{o.status}</span>
                  </td>
                  <td>{o.items.length}</td>
                  <td>{o.scheme}</td>
                </tr>
              ))}
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
