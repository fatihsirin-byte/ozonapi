import Link from "next/link";
import { getAseDeclarationBacklog } from "@/modules/orders/orders.service";

// ASE'nin gümrük beyanı vermediği (ya da iptal etmediği) kargoya verilmiş/teslim edilmiş
// siparişleri, en uzun süredir bekleyen en üstte olacak şekilde listeler — kullanıcı talebi
// (2026-09-16): "bi view yapıp beyanname durumunu takip etmeliyiz kaç gün geçti beyannamesi yok
// gibi çoktan aza". Bu sayfa sadece OKUMA yapar, ASE'ye ya da Ozon'a hiçbir bildirim göndermez.
export const dynamic = "force-dynamic";

// Sayfa çok uzun sürede binlerce satır göstermesin diye (bkz. orders.service.ts
// getAseDeclarationBacklog — filtre zaten "henüz sonuç yok" olanlarla sınırlı, ama bu bir ilk
// kurulum/geçmiş tarama sonrası yine de kalabalık olabilir) en eski (en çok bekleyen) ilk 300
// tanesi gösteriliyor.
const MAX_ROWS = 300;

export default async function AseDurumuPage() {
  const backlog = await getAseDeclarationBacklog();
  const rows = backlog.slice(0, MAX_ROWS);

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>ASE Beyanname Takibi</h1>
      </div>
      <div className="hint" style={{ marginBottom: 16 }}>
        Kargoya verilmiş ya da teslim edilmiş, ama ASE&apos;den henüz beyanname ya da iptal bilgisi
        gelmemiş <strong>{backlog.length}</strong> sipariş var — en uzun süredir bekleyen en üstte.
        {backlog.length > MAX_ROWS && ` (İlk ${MAX_ROWS} tanesi gösteriliyor.)`}
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">Bekleyen sipariş yok — hepsi ya beyanname aldı ya da iptal oldu.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Posting No</th>
              <th>Kargo/Sipariş Tarihi</th>
              <th style={{ whiteSpace: "nowrap" }}>Kaç Gün Geçti</th>
              <th>ASE&apos;ye Gönderim</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.postingNumber}>
                <td>
                  <Link href={`/orders/${o.postingNumber}`}>{o.postingNumber}</Link>
                </td>
                <td>{o.referenceDate ? o.referenceDate.toLocaleDateString("tr-TR") : "-"}</td>
                <td>
                  {o.daysElapsed != null ? (
                    <span style={o.daysElapsed >= 14 ? { color: "var(--danger)", fontWeight: 500 } : undefined}>
                      {o.daysElapsed} gün
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td>
                  {o.aseShipmentSuccess === true ? (
                    <span className="hint">Panelden gönderildi ✓</span>
                  ) : o.aseShipmentSuccess === false ? (
                    <span className="hint" style={{ color: "var(--danger)" }}>
                      Panelden hata: {o.aseShipmentMessage ?? "bilinmeyen"}
                    </span>
                  ) : (
                    <span className="hint">Panelden hiç denenmedi</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
