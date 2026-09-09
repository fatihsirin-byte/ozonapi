import Link from "next/link";
import { getPnlRows, summarizePnlRows, groupMissingCostPrice, filterShippingLoss } from "@/modules/finance/pnl-report.service";
import { PnlToolbar } from "./PnlToolbar";
import { CostPriceCell } from "./CostPriceCell";
import { CopyableProductName } from "./CopyableProductName";
import { PnlTabs } from "./PnlTabs";
import { PnlMainTable } from "./PnlMainTable";

export const dynamic = "force-dynamic";

function fmtMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null) {
  if (n == null) return "-";
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}%`;
}

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{ missingCost?: string; shippingLoss?: string }>;
}) {
  const params = await searchParams;
  const showMissingCostOnly = params.missingCost === "1";
  const showShippingLossOnly = params.shippingLoss === "1";

  const allRows = await getPnlRows();
  const shippingLossRows = filterShippingLoss(allRows);
  const rows = showShippingLossOnly ? shippingLossRows : allRows;
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
        {shippingLossRows.length > 0 && (
          <div className="hint" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            {shippingLossRows.length} kalemde gerçek kargo, ağırlıktan çıkan tahminden daha yüksek
            (kırmızı "Fark").
            <Link href={showShippingLossOnly ? "/pnl" : "/pnl?shippingLoss=1"}>
              <button className="btn-secondary" style={{ padding: "2px 10px", fontSize: 12 }}>
                {showShippingLossOnly ? "Tüm listeye dön" : "Sadece zarar edilen kargoları göster"}
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
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {g.productImage && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={g.productImage}
                            alt=""
                            width={40}
                            height={40}
                            style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
                          />
                        )}
                        <div>
                          <div>
                            <CopyableProductName name={g.productName} nameRu={g.productNameRu} />
                          </div>
                          <div className="hint">
                            {g.offerId}
                            {g.ozonSku && (
                              <>
                                {" · "}
                                <a
                                  href={`https://www.ozon.ru/context/detail/id/${g.ozonSku}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Ozon'da gör ↗
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
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
          <PnlMainTable rows={rows} />
        )}
      </div>
      )}
    </div>
  );
}
