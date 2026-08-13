import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderDetail, computeOrderAmount, computeOrderCost } from "@/modules/orders/orders.service";
import { PurchaseInvoiceField } from "./PurchaseInvoiceField";
import { OzonInvoicePanel } from "./OzonInvoicePanel";
import { EtgbInfo } from "./EtgbInfo";
import { CopyableField } from "./CopyableField";
import { transliterateRussian } from "@/utils/transliterate";
import { LabelDownloadButton } from "./LabelDownloadButton";
import { RealWeightInput } from "./RealWeightInput";

export const dynamic = "force-dynamic";

function formatMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Ozon'un finans/işlem API'si (FinanceTransaction — komisyon/kargo/diğer kesinti/net) tutarları
// RUB cinsinden dönüyor, hesabın sözleşme para birimi USD olsa da (2026-08-14'te Ozon'un kendi
// satıcı panelindeki "-360 ₽" değeriyle karşılaştırılıp doğrulandı — bizim sistem bunu yanlışlıkla
// "-$360" olarak gösteriyordu, ~80x büyütülmüş görünüyordu). Sabit bir kurla $'a çevirmek yerine
// gerçek para birimini (₽) gösteriyoruz — tahmini bir kur kullanmak yeni bir hata riski taşır.
function formatRub(n: number) {
  return `₽${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface OrderRawPayload {
  shipment_date?: string;
  customer?: {
    name?: string;
    phone?: string;
    address?: { city?: string; region?: string; district?: string; address_tail?: string; country?: string };
  };
  addressee?: { name?: string; phone?: string };
  analytics_data?: { warehouse?: string; tpl_provider?: string };
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
  const raw = order.rawPayload as OrderRawPayload | null;
  const city = raw?.customer?.address?.city;
  const region = raw?.customer?.address?.region;
  const customerName = raw?.customer?.name || raw?.addressee?.name;
  const customerPhone = raw?.customer?.phone || raw?.addressee?.phone;
  const addressTail = raw?.customer?.address?.address_tail;
  const district = raw?.customer?.address?.district;
  const orderCost = computeOrderCost(order.items);
  const orderAmount = computeOrderAmount(order.items);

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>{order.postingNumber}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <LabelDownloadButton postingNumber={order.postingNumber} />
          <Link href="/orders">
            <button className="btn-secondary">← Siparişler</button>
          </Link>
        </div>
      </div>

      <div className="card summary-grid" style={{ marginBottom: 16 }}>
        <div>
          <div className="hint">Durum</div>
          <span className="badge pending">{order.status}</span>
        </div>
        <div>
          <div className="hint">Şema</div>
          <div className="value">{order.scheme}</div>
        </div>
        <div>
          <div className="hint">Sipariş Tarihi</div>
          <div className="value" style={{ fontSize: 15 }}>{order.orderDate ? new Date(order.orderDate).toLocaleString("tr-TR") : "-"}</div>
        </div>
        <div>
          <div className="hint">Sipariş Tutarı</div>
          <div className="value">{formatMoney(orderAmount)}</div>
        </div>
        <div>
          <div className="hint">Alış Maliyeti</div>
          <div className="value" style={{ color: "var(--danger)" }}>
            {orderCost == null ? <span className="hint">yok</span> : formatMoney(orderCost)}
          </div>
        </div>
        {orderCost != null && (
          <div>
            <div className="hint">Brüt Kâr</div>
            <div className="value" style={{ color: orderAmount - orderCost >= 0 ? "var(--success)" : "var(--danger)" }}>
              {formatMoney(orderAmount - orderCost)}
            </div>
          </div>
        )}
        {raw?.shipment_date && (
          <div>
            <div className="hint">Kargo Tarihi</div>
            <div className="value" style={{ fontSize: 15 }}>{new Date(raw.shipment_date).toLocaleDateString("tr-TR")}</div>
          </div>
        )}
        {customerName && <CopyableField label="Ad Soyad" value={customerName.trim()} />}
        {customerName && <CopyableField label="Ad Soyad (Latin — fatura için)" value={transliterateRussian(customerName.trim())} />}
        {customerPhone && <CopyableField label="Telefon" value={customerPhone} />}
        {city && <CopyableField label="Şehir" value={city} />}
        {city && <CopyableField label="Şehir (Latin — fatura için)" value={transliterateRussian(city)} />}
        {(district || region) && <CopyableField label="İlçe" value={district || region || ""} />}
        {(district || region) && (
          <CopyableField label="İlçe (Latin — fatura için)" value={transliterateRussian(district || region || "")} />
        )}
        {addressTail && <CopyableField label="Adres" value={addressTail} />}
        {addressTail && <CopyableField label="Adres (Latin — fatura için)" value={transliterateRussian(addressTail)} />}
        {raw?.analytics_data?.tpl_provider && (
          <div>
            <div className="hint">Kargo Sağlayıcı</div>
            <div className="value" style={{ fontSize: 15 }}>{raw.analytics_data.tpl_provider}</div>
          </div>
        )}
        <div>
          <PurchaseInvoiceField postingNumber={order.postingNumber} initialValue={order.purchaseInvoiceNumber} />
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
                <th></th>
                <th>Offer ID</th>
                <th>Ürün</th>
                <th>Adet</th>
                <th>Satış Fiyatı</th>
                <th>Alış Fiyatı</th>
                <th>Brüt Kâr</th>
                <th>Gerçek Ağırlık</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => {
                const thumbnail = Array.isArray(item.product?.images) ? (item.product?.images as string[])[0] : null;
                const unitCost = item.product?.costPrice ? Number(item.product.costPrice) : null;
                return (
                  <tr key={item.id}>
                    <td>
                      {thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbnail}
                          alt=""
                          width={48}
                          height={48}
                          className="zoom-thumb-5x"
                          style={{ objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                        />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 6, background: "var(--border)" }} />
                      )}
                    </td>
                    <td>
                      {item.product ? <Link href={`/products/${item.offerId}`}>{item.offerId}</Link> : item.offerId}
                    </td>
                    <td>{item.product?.name ?? "-"}</td>
                    <td>{item.quantity}</td>
                    <td>${item.price}</td>
                    <td>{unitCost != null ? formatMoney(unitCost) : <span className="hint">yok</span>}</td>
                    <td>
                      {unitCost != null
                        ? formatMoney(Number(item.price) * item.quantity - unitCost * item.quantity)
                        : "-"}
                    </td>
                    <td>
                      {item.product ? (
                        <RealWeightInput
                          offerId={item.offerId}
                          initialConfirmed={item.product.weightConfirmed}
                          initialWeightGrams={item.product.weightGrams}
                          initialPrice={item.product.price}
                        />
                      ) : (
                        <span className="hint">ürün yok</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Ozon Faturası (Proforma / KDV İadesi)</h3>
        <OzonInvoicePanel
          postingNumber={order.postingNumber}
          items={order.items.map((item) => ({
            offerId: item.offerId,
            name: item.product?.name ?? item.offerId,
            ozonSku: item.ozonSku != null ? String(item.ozonSku) : null,
          }))}
          defaultPrice={orderAmount}
          suggestedInvoiceAmount={orderCost == null ? null : orderCost * 1.4}
        />
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div className="hint" style={{ marginBottom: 6 }}>ETGB (Türk Gümrük Beyanı — otomatik oluşur, salt okunur)</div>
          <EtgbInfo postingNumber={order.postingNumber} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Finans Kesintileri (PNL)</h3>
        <div className="hint" style={{ marginBottom: 16 }}>
          Bu bölümdeki tutarlar Ozon'un finans/işlem verisinden geliyor ve <strong>₽ (RUB)</strong> cinsinden —
          yukarıdaki $ tutarlarla (satış/alış/brüt kâr, bizim kendi USD fiyatımız) karıştırılmasın.
        </div>
        <div className="summary-grid" style={{ marginBottom: 16 }}>
          <div>
            <div className="hint">Toplam Tutar</div>
            <div className="value">{formatRub(totals.amount)}</div>
          </div>
          <div>
            <div className="hint">Komisyon</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatRub(totals.commission)}</div>
          </div>
          <div>
            <div className="hint">Kargo</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatRub(totals.delivery)}</div>
          </div>
          <div>
            <div className="hint">Diğer</div>
            <div className="value" style={{ color: "var(--danger)" }}>{formatRub(totals.other)}</div>
          </div>
          <div>
            <div className="hint">Net</div>
            <div className="value" style={{ color: net >= 0 ? "var(--success)" : "var(--danger)" }}>{formatRub(net)}</div>
          </div>
        </div>
        {order.transactions.length === 0 ? (
          <div className="empty-state">
            Henüz finans işlemi yok — Ozon bunu sipariş teslim edildikten sonra muhasebeleştiriyor.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Tip</th>
                <th>Tutar (₽)</th>
                <th>Komisyon (₽)</th>
                <th>Kargo (₽)</th>
                <th>Diğer (₽)</th>
              </tr>
            </thead>
            <tbody>
              {order.transactions.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.operationDate).toLocaleString("tr-TR")}</td>
                  <td>{t.operationType}</td>
                  <td>{formatRub(t.amount)}</td>
                  <td>{formatRub(t.commissionAmount ?? 0)}</td>
                  <td>{formatRub(t.deliveryCharge ?? 0)}</td>
                  <td>{formatRub(t.otherCharges ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
