import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderDetail, computeOrderAmount, computeOrderCost, computeOrderEstimatedProfit } from "@/modules/orders/orders.service";
import { PurchaseInvoiceField } from "./PurchaseInvoiceField";
import { CopyableField } from "./CopyableField";
import { transliterateRussian } from "@/utils/transliterate";
import { LabelDownloadButton } from "./LabelDownloadButton";
import { RealWeightInput } from "./RealWeightInput";
import { ParasutInvoiceButton } from "../ParasutInvoiceButton";
import { estimateShippingForWeight, effectiveCargoWeightGrams, sumRealShippingRub } from "@/modules/finance/pnl-report.service";
import { getUsdToRubRate } from "@/pricing/fx-rate";
import { translateOrderStatus } from "@/utils/orderStatus";

export const dynamic = "force-dynamic";

function formatMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  // Sipariş bulunduktan SONRA çekiliyor — Promise.all ile paralel yapılırsa (önceki denemede
  // olduğu gibi) var olmayan bir sipariş için bile önbelleği boş kur çekme isteğinin bitmesini
  // (8 saniyeye kadar) beklemek zorunda kalınıyordu, 404 gecikiyordu (2026-09-10'da code
  // review'da tespit edildi — sadece bağımsız oldukları için paralelleştirmek yeterli değilmiş).
  const usdToRubRate = await getUsdToRubRate();

  const raw = order.rawPayload as OrderRawPayload | null;
  const city = raw?.customer?.address?.city;
  const region = raw?.customer?.address?.region;
  const customerName = raw?.customer?.name || raw?.addressee?.name;
  const customerPhone = raw?.customer?.phone || raw?.addressee?.phone;
  const addressTail = raw?.customer?.address?.address_tail;
  const district = raw?.customer?.address?.district;
  const orderCost = computeOrderCost(order.items);
  const orderAmount = computeOrderAmount(order.items);

  // Tahmini kargo (ağırlıktan) + olası net kâr — PNL sayfasındaki aynı tarife/kademeli hesap
  // mantığı (kalemlerin toplam ağırlığı TEK SEFERDE formüle uygulanıyor, bkz. pnl-report.service.ts
  // computeRowMetrics yorumu) sipariş detayında da görülsün diye (2026-09-09, kullanıcı talebi).
  const totalWeightForShipping = order.items.reduce((sum, item) => {
    const w = effectiveCargoWeightGrams(item.product);
    return w != null ? sum + w * item.quantity : sum;
  }, 0);
  const hasWeightData = order.items.every((item) => effectiveCargoWeightGrams(item.product) != null);
  const estimatedShippingUsd = hasWeightData && totalWeightForShipping > 0 ? estimateShippingForWeight(totalWeightForShipping) : null;

  // Ozon bu siparişin kargo kesintisini GERÇEKTEN işlediyse (teslimattan sonra) tahmini ağırlık
  // bazlı kargo yerine gerçek tutar kullanılır (2026-09-10, kullanıcı talebi). Siparişler
  // listesindeki "Olası Net Kâr" sütunuyla AYNI fonksiyon — eskiden burada sadece satış-alış-kargo
  // hesaplanıyordu (komisyon/lojistik/banka bedeli hariç), liste ise komisyonu da düşüyordu; aynı
  // sipariş için iki farklı sayfada FARKLI rakamlar görünüyordu (2026-09-10'da code review'da
  // tespit edildi — kullanıcı için kafa karıştırıcı, "uygulama bozuk" izlenimi verir).
  const realShippingRub = sumRealShippingRub(order.transactions);
  const realShippingUsd = realShippingRub != null && usdToRubRate ? realShippingRub / usdToRubRate : null;
  const possibleNetProfit = computeOrderEstimatedProfit(order.items, realShippingUsd);

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>{order.postingNumber}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <LabelDownloadButton postingNumber={order.postingNumber} />
          <ParasutInvoiceButton
            postingNumber={order.postingNumber}
            initialInvoiceNo={order.parasutInvoiceNo}
            initialPrintUrl={order.parasutPrintUrl}
          />
          <Link href="/orders">
            <button className="btn-secondary">← Siparişler</button>
          </Link>
        </div>
      </div>

      <div className="card summary-grid" style={{ marginBottom: 16 }}>
        <div>
          <div className="hint">Durum</div>
          <span className="badge pending">{translateOrderStatus(order.status)}</span>
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
        <div>
          <div className="hint">Tahmini Kargo (Ağırlıktan)</div>
          <div className="value" style={{ color: "var(--danger)" }}>
            {estimatedShippingUsd == null ? <span className="hint">ağırlık yok</span> : formatMoney(estimatedShippingUsd)}
          </div>
        </div>
        <div>
          <div className="hint">Olası Net Kâr (kargo dahil)</div>
          <div className="value" style={{ color: possibleNetProfit == null ? undefined : possibleNetProfit >= 0 ? "var(--success)" : "var(--danger)" }}>
            {possibleNetProfit == null ? <span className="hint">-</span> : formatMoney(possibleNetProfit)}
          </div>
        </div>
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
    </div>
  );
}
