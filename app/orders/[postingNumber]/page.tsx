import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderDetail } from "@/modules/orders/orders.service";

export const dynamic = "force-dynamic";

function formatMoney(n: number) {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ postingNumber: string }>;
}) {
  const { postingNumber } = await params;
  const order = await getOrderDetail(decodeURIComponent(postingNumber));
  if (!order) notFound();

  const totals = order.transactions.reduce(
    (acc, t) => {
      acc.amount += t.amount;
      acc.commission += t.commissionAmount ?? 0;
      acc.delivery += t.deliveryCharge ?? 0;
      acc.other += t.otherCharges ?? 0;
      return acc;
    },
    { amount: 0, commission: 0, delivery: 0, other: 0 },
  );
  const net = totals.amount + totals.commission + totals.delivery + totals.other;

  return (
    <div className="page">
      <div className="topbar">
        <h1>{order.postingNumber}</h1>
        <Link href="/orders">
          <button className="btn-secondary">← Siparişler</button>
        </Link>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div className="hint">Durum</div>
            <span className="badge pending">{order.status}</span>
          </div>
          <div>
            <div className="hint">Şema</div>
            <div>{order.scheme}</div>
          </div>
          <div>
            <div className="hint">Sipariş Tarihi</div>
            <div>{order.orderDate ? new Date(order.orderDate).toLocaleString("tr-TR") : "-"}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Kalemler</h3>
        {order.items.length === 0 ? (
          <div className="empty-state">Kalem bulunamadı</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Offer ID</th>
                <th>Ürün</th>
                <th>Adet</th>
                <th>Fiyat</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.product ? <Link href={`/products/${item.offerId}`}>{item.offerId}</Link> : item.offerId}
                  </td>
                  <td>{item.product?.name ?? "-"}</td>
                  <td>{item.quantity}</td>
                  <td>{item.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Finans Kesintileri (PNL)</h3>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <div className="hint">Satış Tutarı</div>
            <div style={{ fontSize: 18 }}>{formatMoney(totals.amount)}</div>
          </div>
          <div>
            <div className="hint">Komisyon</div>
            <div style={{ fontSize: 18, color: "var(--danger)" }}>{formatMoney(totals.commission)}</div>
          </div>
          <div>
            <div className="hint">Kargo</div>
            <div style={{ fontSize: 18, color: "var(--danger)" }}>{formatMoney(totals.delivery)}</div>
          </div>
          <div>
            <div className="hint">Diğer</div>
            <div style={{ fontSize: 18, color: "var(--danger)" }}>{formatMoney(totals.other)}</div>
          </div>
          <div>
            <div className="hint">Net</div>
            <div style={{ fontSize: 18, color: "var(--success)" }}>{formatMoney(net)}</div>
          </div>
        </div>
        {order.transactions.length === 0 ? (
          <div className="empty-state">Henüz finans işlemi senkronize edilmedi</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Tip</th>
                <th>Tutar</th>
                <th>Komisyon</th>
                <th>Kargo</th>
                <th>Diğer</th>
              </tr>
            </thead>
            <tbody>
              {order.transactions.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.operationDate).toLocaleString("tr-TR")}</td>
                  <td>{t.operationType}</td>
                  <td>{formatMoney(t.amount)}</td>
                  <td>{formatMoney(t.commissionAmount ?? 0)}</td>
                  <td>{formatMoney(t.deliveryCharge ?? 0)}</td>
                  <td>{formatMoney(t.otherCharges ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
