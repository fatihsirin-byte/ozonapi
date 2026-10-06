import {
  getShippingDisputeGroups,
  SHIPPING_DISPUTE_THRESHOLD_USD,
  EXTRASMALL_WAREHOUSE_LABEL,
  type ShippingDisputeRow,
} from "@/modules/finance/shipping-dispute.service";
import { MarkDisputedButton } from "./MarkDisputedButton";

export const dynamic = "force-dynamic";

function fmtMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("tr-TR");
}

function RowsTable({ rows, extraColumn }: { rows: ShippingDisputeRow[]; extraColumn?: "disputed" | "resolved" }) {
  if (rows.length === 0) return <div className="empty-state">Bu grupta sipariş yok.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Sipariş No</th>
          <th>Sipariş Tarihi</th>
          <th style={{ whiteSpace: "nowrap" }}>Ozon Kargo Ücreti</th>
          {extraColumn === "disputed" && <th style={{ whiteSpace: "nowrap" }}>İtiraz Tarihi</th>}
          {extraColumn === "resolved" && (
            <>
              <th style={{ whiteSpace: "nowrap" }}>İtiraz Anındaki Tutar</th>
              <th style={{ whiteSpace: "nowrap" }}>Düzeltilen Tutar</th>
              <th style={{ whiteSpace: "nowrap" }}>Düzeltme Tarihi</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.postingNumber}>
            <td>{r.postingNumber}</td>
            <td>{r.orderDate ?? "-"}</td>
            <td>{fmtMoney(r.shippingUsd)} <span className="hint">({r.shippingRub.toLocaleString("tr-TR")} ₽)</span></td>
            {extraColumn === "disputed" && <td>{fmtDate(r.disputedAt)}</td>}
            {extraColumn === "resolved" && (
              <>
                <td>{r.disputedAmountUsd != null ? fmtMoney(r.disputedAmountUsd) : "-"}</td>
                <td style={{ color: (r.resolvedAmountUsd ?? 0) < (r.disputedAmountUsd ?? 0) ? "var(--success)" : "var(--danger)" }}>
                  {r.resolvedAmountUsd != null ? fmtMoney(r.resolvedAmountUsd) : "-"}
                </td>
                <td>{fmtDate(r.resolvedAt)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function FinansMutabakatPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const activeTab = (["notDisputed", "disputed", "resolved", "anomalies"] as const).includes(tab as never)
    ? (tab as "notDisputed" | "disputed" | "resolved" | "anomalies")
    : "notDisputed";

  const groups = await getShippingDisputeGroups();

  const tabs: Array<{ key: typeof activeTab; label: string; count: number }> = [
    { key: "notDisputed", label: "İtiraz Edilmedi (Yeni)", count: groups.notDisputed.length },
    { key: "disputed", label: "İtiraz Edildi (Bekliyor)", count: groups.disputed.length },
    { key: "resolved", label: "Düzeltildi", count: groups.resolved.length },
    { key: "anomalies", label: "Veri Hatası (Şüpheli)", count: groups.anomalies.length },
  ];

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Finans Mütabakatı — Kargo</h1>
      </div>

      <div className="hint" style={{ marginBottom: 16 }}>
        <strong>{EXTRASMALL_WAREHOUSE_LABEL}</strong> (extrasmall tarife) deposundan çıkan, teslim
        edilmiş siparişlerde Ozon'un gerçek kargo kesintisi {fmtMoney(SHIPPING_DISPUTE_THRESHOLD_USD)}
        {" "}üzerinde geldiyse burada listelenir. Bir siparişi Ozon'a bildirip itiraz ettiğinizde
        "Tümünü İtiraz Edildi İşaretle" ile işaretleyin — o anki tutar donar, sistem periyodik olarak
        Ozon'un kesintiyi düzeltip düzeltmediğini kontrol eder ve düzelttiğinde otomatik olarak
        "Düzeltildi" sekmesine taşır. Yeniden aynı şekilde ({fmtMoney(SHIPPING_DISPUTE_THRESHOLD_USD)}{" "}
        üzeri) gelen YENİ siparişler otomatik olarak "İtiraz Edilmedi (Yeni)" sekmesine düşer —
        itiraz etme kararı her zaman elle verilir.
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <a
              key={t.key}
              href={`/finans-mutabakat?tab=${t.key}`}
              className={`btn-secondary${activeTab === t.key ? " active" : ""}`}
              style={{
                textDecoration: "none",
                ...(activeTab === t.key ? { background: "var(--accent)", color: "#fff" } : {}),
              }}
            >
              {t.label} ({t.count})
            </a>
          ))}
        </div>
      </div>

      <div className="card">
        {activeTab === "notDisputed" && (
          <>
            <h3 style={{ marginTop: 0 }}>İtiraz Edilmedi ({groups.notDisputed.length})</h3>
            {groups.notDisputed.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <MarkDisputedButton postingNumbers={groups.notDisputed.map((r) => r.postingNumber)} />
              </div>
            )}
            <RowsTable rows={groups.notDisputed} />
          </>
        )}
        {activeTab === "disputed" && (
          <>
            <h3 style={{ marginTop: 0 }}>İtiraz Edildi, Bekliyor ({groups.disputed.length})</h3>
            <RowsTable rows={groups.disputed} extraColumn="disputed" />
          </>
        )}
        {activeTab === "resolved" && (
          <>
            <h3 style={{ marginTop: 0 }}>Düzeltildi ({groups.resolved.length})</h3>
            <RowsTable rows={groups.resolved} extraColumn="resolved" />
          </>
        )}
        {activeTab === "anomalies" && (
          <>
            <h3 style={{ marginTop: 0 }}>Veri Hatası — Şüpheli Tutarlar ({groups.anomalies.length})</h3>
            <div className="hint" style={{ marginBottom: 12 }}>
              Bu siparişlerde Ozon'un kargo kesintisi $50'nin üzerinde görünüyor — tek bir extrasmall
              paket için mantıksız derecede yüksek, muhtemelen Ozon tarafında yanlış eşleşmiş bir
              muhasebe kaydı. İtiraz iş akışının dışında tutuldu, sadece bilgi amaçlıdır.
            </div>
            <RowsTable rows={groups.anomalies} />
          </>
        )}
      </div>
    </div>
  );
}
