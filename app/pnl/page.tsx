import {
  getPnlRows,
  summarizePnlRows,
  groupMissingCostPrice,
  filterShippingLoss,
  filterShippingMismatch,
  overrideDisputedShippingWithEstimate,
} from "@/modules/finance/pnl-report.service";
import { PnlToolbar } from "./PnlToolbar";
import { CostPriceCell } from "./CostPriceCell";
import { CopyableProductName } from "./CopyableProductName";
import { PnlTabs } from "./PnlTabs";
import { PnlMainTable } from "./PnlMainTable";
import { PnlFilterControls } from "./PnlFilterControls";

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
  searchParams: Promise<{
    missingCost?: string;
    shippingLoss?: string;
    shippingMismatch?: string;
    useEstimateForDisputed?: string;
  }>;
}) {
  const params = await searchParams;
  const showMissingCostOnly = params.missingCost === "1";
  const showShippingLossOnly = params.shippingLoss === "1";
  const showShippingMismatchOnly = params.shippingMismatch === "1";
  const useEstimateForDisputed = params.useEstimateForDisputed === "1";

  const fetchedRows = await getPnlRows();
  // "Mütabık olunmayan kargoları tahminle değiştir" checkbox'ı — bu satırlarda gerçek kargo
  // yok sayılıp ağırlık tahminine düşülür, TÜM aşağıdaki hesaplar (Özet, tablo, CSV) bunun
  // üzerinden devam eder (2026-09-09, kullanıcı talebi).
  const allRows = useEstimateForDisputed ? overrideDisputedShippingWithEstimate(fetchedRows) : fetchedRows;

  // ÖNEMLİ: filtre kontrollerinin (buton/checkbox) görünürlüğü HER ZAMAN ham veriden (override
  // uygulanmamış fetchedRows) hesaplanır — checkbox'ı işaretleyince "mütabık olunmayan" kalem
  // sayısı 0'a düşüyor (zaten o yüzden işaretlendi), bu sayıya bağlı kalınsaydı checkbox/butonlar
  // işaretlenir işaretlenmez ekrandan kaybolur, bir daha kapatılamazdı (2026-09-09'da kullanıcı
  // bulgusu — "diğer seçenekler gitti").
  const shippingLossRowsForControls = filterShippingLoss(fetchedRows);
  const shippingMismatchRowsForControls = filterShippingMismatch(fetchedRows);

  const rows = showShippingLossOnly
    ? filterShippingLoss(allRows)
    : showShippingMismatchOnly
      ? filterShippingMismatch(allRows)
      : allRows;
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
              {fmtMoney(totals.feesUsd)}
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
        <PnlFilterControls
          missingCostCount={totals.missingCostCount}
          missingCostGroupCount={missingCostGroups.length}
          shippingLossCount={shippingLossRowsForControls.length}
          shippingMismatchCount={shippingMismatchRowsForControls.length}
        />
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
