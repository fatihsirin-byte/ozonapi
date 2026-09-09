import { getShippingReviewRows } from "@/modules/finance/pnl-report.service";
import { PnlTabs } from "../PnlTabs";
import { KargoKontroluTable } from "./KargoKontroluTable";

export const dynamic = "force-dynamic";

export default async function KargoKontroluPage() {
  const rows = await getShippingReviewRows();

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Kâr/Zarar Raporu</h1>
      </div>

      <PnlTabs active="kargo-kontrolu" />

      <div className="hint" style={{ marginBottom: 16 }}>
        Ozon'un kargo kesintisini GERÇEKTEN işlediği (yani teslim edilmiş, finans verisi gelmiş)
        sipariş kalemleri burada listelenir. Bir kalemi işaretlediğinizde, aynı ürünün kargo ücreti
        işaretlediğinizle aynı ya da daha düşük olan diğer siparişleri de otomatik "incelendi"
        sayılıp gizlenir — hepsini tek tek kontrol etmenize gerek kalmaz. Ürün adına tıklayarak
        (varyant eki olmadan) Ozon panelinde aratmak üzere kopyalayabilirsiniz.
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty-state">
            Henüz gerçek kargo kesintisi işlenmiş sipariş yok — Ozon bunu teslimattan sonra işliyor.
          </div>
        ) : (
          <KargoKontroluTable rows={rows} />
        )}
      </div>
    </div>
  );
}
