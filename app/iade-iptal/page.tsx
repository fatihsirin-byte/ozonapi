import {
  getReturnsForRange,
  summarizeReturns,
  getRfbsReturnsForRange,
  summarizeRfbsReturns,
  getCancelledOrdersSummary,
  type RfbsReturnCategory,
} from "@/modules/returns/returns.service";
import { formatIstanbulDate } from "@/utils/istanbulTime";
import { ReturnsSyncButton } from "./ReturnsSyncButton";

// Kullanıcı talebi (2026-09-18): "ozondaki iade ve iptaller için sayfa yapmamız lazım, hangilerinin
// maliyeti silindi anlayamadım" — İLK sürüm yanlış uç noktayı (/v1/returns/list) kullandığı için hep
// "0 iade" gösteriyordu. Kullanıcı Ozon panelinden indirdiği gerçek rapor ile bunun yanlış olduğunu
// kanıtladı: hesap "realFBS" şeması kullanıyor, gerçek veri /v2/returns/rfbs/list'te duruyor (bkz.
// src/ozon/rfbsReturns.ts). Asıl önemli veri BU — imha edilen ve müşteriye parası iade edilen
// kayıtlar. Kullanıcı notu: "normal iptaller önemli değil" — sevkiyattan önceki düz iptaller (ürün
// hiç yola çıkmadı, maliyet yok) bu yüzden sayfanın en altında küçük bir bilgi notu olarak duruyor,
// ana odak rFBS imha/para-iade kayıtları.
export const dynamic = "force-dynamic";

const RFBS_CATEGORY_LABELS: Record<RfbsReturnCategory, string> = {
  utilized: "İmha edildi/ediliyor",
  refunded: "Müşteriye para iade edildi",
  other: "Diğer",
};

const RFBS_CATEGORY_COLORS: Record<RfbsReturnCategory, string> = {
  utilized: "var(--danger)",
  refunded: "var(--warning)",
  other: "var(--border)",
};

function formatUsd(amount: number) {
  return `$${amount.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

export default async function IadeIptalPage() {
  const to = new Date();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [rfbsReturns, oldReturns, cancelledSummary] = await Promise.all([
    getRfbsReturnsForRange({ since, to }),
    getReturnsForRange({ since, to }),
    getCancelledOrdersSummary({ since, to }),
  ]);
  const rfbsSummary = summarizeRfbsReturns(rfbsReturns);
  const oldSummary = summarizeReturns(oldReturns);
  const totalLostValue = rfbsSummary.utilizedValue + rfbsSummary.refundedValue;

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>İade &amp; İptaller</h1>
        <ReturnsSyncButton />
      </div>
      <div className="hint" style={{ marginBottom: 16 }}>
        Son 90 gün — {rfbsSummary.totalCount} imha/iade kaydı. Veri hiç senkronize edilmediyse önce
        &quot;Senkronize Et&quot; butonuna basın.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div className="card">
          <div className="hint">İmha edilen ürünler</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "var(--danger)" }}>{rfbsSummary.utilizedCount} adet</div>
          <div className="hint">Ürün müşteriye ulaşmadı/kabul edilmedi, Ozon deposunda imha edildi ya da imha sürecinde — ürün tamamen kayıp.</div>
        </div>
        <div className="card">
          <div className="hint">Müşteriye para iade edilen</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "var(--warning)" }}>{rfbsSummary.refundedCount} adet</div>
          <div className="hint">Satış bedeli müşteriye geri ödendi/tazmin edildi.</div>
        </div>
        <div className="card">
          <div className="hint">Kaybedilen satış tutarı (imha + para iadesi)</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "var(--danger)" }}>{formatUsd(totalLostValue)}</div>
          <div className="hint">Müşteriden alınacak/alınan satış bedeli üzerinden.</div>
        </div>
        <div className="card">
          <div className="hint">Gerçek maliyet kaybınız (ürün alış fiyatı)</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "var(--danger)" }}>{formatUsd(rfbsSummary.totalCostLost)}</div>
          <div className="hint">
            Ürün kataloğunuzdaki alış fiyatları (maliyet) üzerinden hesaplandı — asıl cebinizden çıkan bu.
            {rfbsSummary.unknownCostCount > 0 && (
              <> <strong>{rfbsSummary.unknownCostCount}</strong> kayıtta maliyet fiyatı bilinmiyor (ürün kataloğunuzda kayıtlı değil ya da alış fiyatı hiç girilmemiş) — bu rakam olduğundan düşük görünüyor olabilir.</>
            )}
          </div>
        </div>
      </div>

      {rfbsReturns.length === 0 ? (
        <div className="empty-state">Bu aralıkta imha/iade kaydı yok (ya da henüz senkronize edilmedi).</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Posting No</th>
              <th>Ürün</th>
              <th>Durum</th>
              <th>Kategori</th>
              <th>Satış Bedeli</th>
              <th>Maliyet (Alış Fiyatı)</th>
              <th>Tarih</th>
            </tr>
          </thead>
          <tbody>
            {rfbsReturns.map((r) => (
              <tr key={r.id}>
                <td>{r.postingNumber}</td>
                <td>
                  {r.productName ?? "-"}
                  {r.offerId && <div className="hint">{r.offerId}</div>}
                </td>
                <td>{r.stateName ?? "-"}</td>
                <td>
                  <span style={{ color: RFBS_CATEGORY_COLORS[r.category], fontWeight: 500 }}>{RFBS_CATEGORY_LABELS[r.category]}</span>
                </td>
                <td>{r.price != null ? formatUsd(r.price) : "-"}</td>
                <td style={{ fontWeight: 500 }}>
                  {r.costPrice != null ? formatUsd(r.costPrice) : <span className="hint">bilinmiyor</span>}
                </td>
                <td>{r.createdAt ? formatIstanbulDate(r.createdAt) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="hint" style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        Ayrıca son 90 günde kargoya hiç çıkmadan iptal edilen <strong>{cancelledSummary.count}</strong> sipariş var
        (toplam ~{cancelledSummary.totalAmount.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} RUB) — bunlar
        ürün hiç yola çıkmadığı için normalde gerçek bir maliyet oluşturmaz, önemli olan yukarıdaki imha/para iadesi
        kayıtları.
        {oldSummary.totalCount > 0 && (
          <> Ayrıca standart FBO/FBS iade sisteminde {oldSummary.totalCount} kayıt daha var.</>
        )}
      </div>
    </div>
  );
}
