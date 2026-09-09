import Link from "next/link";
import { getPnlRows, computeRowMetrics, summarizePnlRows } from "@/modules/finance/pnl-report.service";
import { PnlToolbar } from "./PnlToolbar";
import { CostPriceCell } from "./CostPriceCell";
import { CopyableProductName } from "./CopyableProductName";
import { PnlTabs } from "./PnlTabs";

export const dynamic = "force-dynamic";

function fmtMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null) {
  if (n == null) return "-";
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}%`;
}

const WEIGHT_SOURCE_LABEL = {
  measured: "Ölçülmüş",
  estimated: "Tahmini",
  unknown: "-",
} as const;

export default async function PnlPage() {
  const rows = await getPnlRows();
  const totals = summarizePnlRows(rows);

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Kâr/Zarar Raporu</h1>
        <PnlToolbar />
      </div>

      <PnlTabs active="tum-siparisler" />

      <div className="hint" style={{ marginBottom: 16 }}>
        Bugüne kadar senkronize edilmiş <strong>tüm siparişlerin</strong> kalem bazında kâr/zarar dökümü.
        Fiyat formülündeki (komisyon %5, lojistik hizmet bedeli %2 / tavan 200₽, banka ücreti %1.9,
        ASE kargo tarifesi) oranlar kullanılıyor — Ozon'un gerçekleşmiş finans hareketlerine değil,
        tahmini bir hesaba dayanıyor. Ağırlığı elle güncellediğiniz (tartılmış) ürünlerde gerçek
        ağırlık, güncellemediklerinizde var olan tahmini ağırlık kullanılıyor.
        {" "}"CSV İndir" ile aynı rapor, oranları değiştirip yeniden hesaplatabileceğiniz canlı
        formüllü bir dosya olarak (Google Sheets'e yüklenebilir) inebilir.
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Özet ({rows.length} sipariş kalemi)</h3>
        <div className="summary-grid">
          <div>
            <div className="hint">Toplam Satış</div>
            <div className="value">{fmtMoney(totals.totalSale)}</div>
          </div>
          <div>
            <div className="hint">Toplam Alış</div>
            <div className="value" style={{ color: "var(--danger)" }}>{fmtMoney(totals.totalCost)}</div>
          </div>
          <div>
            <div className="hint">Kargo</div>
            <div className="value" style={{ color: "var(--danger)" }}>{fmtMoney(totals.shipping)}</div>
          </div>
          <div>
            <div className="hint">Komisyon + Lojistik + Banka</div>
            <div className="value" style={{ color: "var(--danger)" }}>
              {fmtMoney(totals.commission + totals.logistics + totals.bankFee)}
            </div>
          </div>
          <div>
            <div className="hint">Net Kâr</div>
            <div className="value" style={{ color: totals.profit >= 0 ? "var(--success)" : "var(--danger)" }}>
              {fmtMoney(totals.profit)}
            </div>
          </div>
          <div>
            <div className="hint">Marj</div>
            <div className="value">{fmtPct(totals.marginPct)}</div>
          </div>
        </div>
        {totals.missingCostCount > 0 && (
          <div className="hint" style={{ marginTop: 12 }}>
            {totals.missingCostCount} kalemde alış fiyatı girilmemiş — bunlar toplamlara dahil edilmedi.
          </div>
        )}
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty-state">
            Henüz sipariş yok. Yukarıdaki "Senkronize Et" ile Ozon'dan sipariş çekin.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>Posting No</th>
                  <th style={{ whiteSpace: "nowrap" }}>Tarih</th>
                  <th style={{ whiteSpace: "nowrap" }}>Durum</th>
                  <th>Ürün</th>
                  <th style={{ whiteSpace: "nowrap" }}>Adet</th>
                  <th style={{ whiteSpace: "nowrap" }}>Satış</th>
                  <th style={{ whiteSpace: "nowrap" }}>Alış</th>
                  <th style={{ whiteSpace: "nowrap" }}>Ağırlık / Kargo</th>
                  <th style={{ whiteSpace: "nowrap" }}>Net Kâr</th>
                  <th style={{ whiteSpace: "nowrap" }}>Marj</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const m = computeRowMetrics(row);
                  return (
                    <tr key={`${row.postingNumber}-${row.offerId}-${i}`}>
                      <td>
                        <Link href={`/orders/${row.postingNumber}`}>{row.postingNumber}</Link>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{row.orderDate ?? "-"}</td>
                      <td>
                        <span className="badge pending">{row.status}</span>
                      </td>
                      <td>
                        <div>
                          <CopyableProductName name={row.productName} nameRu={row.productNameRu} />
                        </div>
                        <div className="hint">{row.offerId}</div>
                      </td>
                      <td>{row.quantity}</td>
                      <td>{fmtMoney(m.totalSale)}</td>
                      <td>{m.totalCost != null ? fmtMoney(m.totalCost) : <CostPriceCell offerId={row.offerId} />}</td>
                      <td className="hint" style={{ whiteSpace: "nowrap" }}>
                        {row.realShippingRub != null ? (
                          <span title={row.approximateShippingSplit ? "Posting'te birden fazla ürün var, tutar satış payına göre paylaştırıldı" : undefined}>
                            {row.approximateShippingSplit ? "~" : ""}₽{row.realShippingRub.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} (gerçek)
                          </span>
                        ) : (
                          <>
                            {row.cargoWeightGrams != null ? `${Math.round(row.cargoWeightGrams)}g` : "-"}
                            {row.weightSource !== "unknown" && ` (${WEIGHT_SOURCE_LABEL[row.weightSource]})`}
                          </>
                        )}
                      </td>
                      <td style={{ color: m.profit == null ? undefined : m.profit >= 0 ? "var(--success)" : "var(--danger)" }}>
                        {m.profit != null ? fmtMoney(m.profit) : <span className="hint" title={m.warning ?? undefined}>{m.warning ?? "-"}</span>}
                      </td>
                      <td>{fmtPct(m.marginPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
