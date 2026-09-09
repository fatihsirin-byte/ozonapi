import Link from "next/link";
import { getPnlRows, computeRowMetrics, summarizePnlRows, groupMissingCostPrice } from "@/modules/finance/pnl-report.service";
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

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{ missingCost?: string }>;
}) {
  const params = await searchParams;
  const showMissingCostOnly = params.missingCost === "1";

  const rows = await getPnlRows();
  const totals = summarizePnlRows(rows);
  const missingCostGroups = groupMissingCostPrice(rows);

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Kâr/Zarar Raporu</h1>
        <PnlToolbar />
      </div>

      <PnlTabs active="tum-siparisler" />

      <div className="hint" style={{ marginBottom: 16 }}>
        <strong>Teslim edilmiş</strong> siparişlerin kalem bazında kâr/zarar dökümü (iptal edilen ve
        henüz kargoda olan siparişler hariç — sadece gerçekleşmiş satış sayılıyor).
        Kargo ücretinde Ozon'un gerçek kesintisi varsa (teslimattan sonra işleniyor) o kullanılıyor —
        Ozon bunu ₽ (RUB) veriyor, güncel günlük kurla $'a çevrilip kâr hesabına katılıyor. Henüz
        gerçek veri yoksa fiyat formülündeki (komisyon %5, lojistik hizmet bedeli %2 / tavan 200₽,
        banka ücreti %1.9) tahmini ASE kargo tarifesi kullanılıyor. Ağırlığı elle güncellediğiniz
        (tartılmış) ürünlerde gerçek ağırlık, güncellemediklerinizde tahmini ağırlık kullanılıyor.
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
          <div className="hint" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            {totals.missingCostCount} kalemde ({missingCostGroups.length} farklı üründe) alış fiyatı girilmemiş —
            bunlar toplamlara dahil edilmedi.
            <Link href={showMissingCostOnly ? "/pnl" : "/pnl?missingCost=1"}>
              <button className="btn-secondary" style={{ padding: "2px 10px", fontSize: 12 }}>
                {showMissingCostOnly ? "Tüm listeye dön" : "Sadece eksik olanları göster"}
              </button>
            </Link>
          </div>
        )}
      </div>

      {showMissingCostOnly ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Alış Fiyatı Eksik Ürünler ({missingCostGroups.length})</h3>
          <div className="hint" style={{ marginBottom: 16 }}>
            Her ürün için alış fiyatı BİR KERE girilir — aynı ürünün kaç siparişi varsa hepsine
            otomatik yansır (fiyat ürün üzerinde tutuluyor, sipariş satırında değil).
          </div>
          {missingCostGroups.length === 0 ? (
            <div className="empty-state">Eksik alış fiyatı kalmadı.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th style={{ whiteSpace: "nowrap" }}>Sipariş Sayısı</th>
                  <th style={{ whiteSpace: "nowrap" }}>Alış Fiyatı</th>
                </tr>
              </thead>
              <tbody>
                {missingCostGroups.map((g) => (
                  <tr key={g.offerId}>
                    <td>
                      <div>
                        <CopyableProductName name={g.productName} nameRu={g.productNameRu} />
                      </div>
                      <div className="hint">{g.offerId}</div>
                    </td>
                    <td>{g.orderCount}</td>
                    <td>
                      <CostPriceCell offerId={g.offerId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
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
                      <td>
                        {m.totalCost != null ? (
                          fmtMoney(m.totalCost)
                        ) : (
                          <Link href="/pnl?missingCost=1" className="hint">
                            eksik
                          </Link>
                        )}
                      </td>
                      <td className="hint" style={{ whiteSpace: "nowrap" }}>
                        {row.realShippingUsd != null ? (
                          <span
                            title={`₽${row.realShippingRub?.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} — güncel kurla çevrildi${row.approximateShippingSplit ? " (posting'te birden fazla ürün var, tutar satış payına göre paylaştırıldı)" : ""}`}
                          >
                            {row.approximateShippingSplit ? "~" : ""}{fmtMoney(row.realShippingUsd)} (gerçek)
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
      )}
    </div>
  );
}
