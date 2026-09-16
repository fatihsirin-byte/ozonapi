import Link from "next/link";
import { getAseDeclarationBacklog, type AseDeclarationBacklogMode } from "@/modules/orders/orders.service";

// ASE'nin gümrük beyanı durumunu takip eder — kullanıcı talebi (2026-09-16): "bi view yapıp
// beyanname durumunu takip etmeliyiz kaç gün geçti beyannamesi yok gibi çoktan aza ... ase'ye
// gönderim tablosunu kaldır gereksiz. sadece toggle ekle beyanname olanler beyanname bekleyenler
// diye. var olanı da görüp bakmak beyanname datasını almak isteriz." Bu sayfa sadece OKUMA yapar,
// ASE'ye ya da Ozon'a hiçbir bildirim göndermez.
export const dynamic = "force-dynamic";

// Sayfa çok uzun sürede binlerce satır göstermesin diye ilk N tanesi gösteriliyor (mode'a göre: en
// çok bekleyen ya da en yeni beyannameli).
const MAX_ROWS = 300;

export default async function AseDurumuPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const params = await searchParams;
  const mode: AseDeclarationBacklogMode = params.mode === "declared" ? "declared" : "pending";
  const backlog = await getAseDeclarationBacklog(mode);
  const rows = backlog.slice(0, MAX_ROWS);

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>ASE Beyanname Takibi</h1>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Link href="/ase-durumu?mode=pending" className={`btn-secondary${mode === "pending" ? " active" : ""}`}>
          Beyannamesi Bekleyenler
        </Link>
        <Link href="/ase-durumu?mode=declared" className={`btn-secondary${mode === "declared" ? " active" : ""}`}>
          Beyannamesi Olanlar
        </Link>
      </div>
      <div className="hint" style={{ marginBottom: 16 }}>
        {mode === "pending" ? (
          <>
            Kargoya verilmiş ya da teslim edilmiş, ama ASE&apos;den henüz beyanname ya da iptal bilgisi
            gelmemiş <strong>{backlog.length}</strong> sipariş var — en uzun süredir bekleyen en üstte.
          </>
        ) : (
          <>
            ASE&apos;den gerçek bir beyanname numarası gelmiş <strong>{backlog.length}</strong> sipariş var — en
            yeni beyanname en üstte.
          </>
        )}
        {backlog.length > MAX_ROWS && ` (İlk ${MAX_ROWS} tanesi gösteriliyor.)`}
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          {mode === "pending" ? "Bekleyen sipariş yok — hepsi ya beyanname aldı ya da iptal oldu." : "Henüz beyannamesi gelen sipariş yok."}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Posting No</th>
              {mode === "pending" ? (
                <>
                  <th>Kargo Süresi (Tahmini)</th>
                  <th style={{ whiteSpace: "nowrap" }}>Kaç Gün Geçti</th>
                </>
              ) : (
                <>
                  <th>Beyanname No</th>
                  <th>Beyanname Tarihi</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.postingNumber}>
                <td>
                  <Link href={`/orders/${o.postingNumber}`}>{o.postingNumber}</Link>
                </td>
                {mode === "pending" ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <td>{o.customDeclarationCode}</td>
                    <td>{o.customDeclarationDate ? o.customDeclarationDate.toLocaleDateString("tr-TR") : "-"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
