import { AladdinInvoicePanel } from "./AladdinInvoicePanel";

export const dynamic = "force-dynamic";

export default function AladdinFaturaPage() {
  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Aladdin → Fatih Gezgin Günlük Fatura</h1>
      </div>
      <div className="hint" style={{ marginBottom: 16 }}>
        Bugün Ozon müşterisine faturası kesilen siparişlerin ürünlerini, Aladdin&apos;in Paraşüt
        hesabından Fatih Gezgin&apos;e GERÇEK bir iç fatura olarak keser. Şu an sadece ELLE
        tetiklenir — otomatik değildir.
      </div>
      <AladdinInvoicePanel />
    </div>
  );
}
