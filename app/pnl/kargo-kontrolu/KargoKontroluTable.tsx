"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PnlRow } from "@/modules/finance/pnl-report.service";
import { CopyableProductName } from "../CopyableProductName";
import { CostPriceCell } from "../CostPriceCell";

function fmtMoney(n: number) {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function key(r: Pick<PnlRow, "postingNumber" | "offerId">) {
  return `${r.postingNumber}|${r.offerId}`;
}

export function KargoKontroluTable({ rows }: { rows: PnlRow[] }) {
  const [reviewed, setReviewed] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.shippingReviewed).map(key)),
  );
  const [showReviewed, setShowReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleRows = useMemo(
    () => (showReviewed ? rows : rows.filter((r) => !reviewed.has(key(r)))),
    [rows, reviewed, showReviewed],
  );

  // Sunucu isteği başarısız olursa (ağ hatası ya da hata kodu) iyimser (optimistic) değişikliği
  // geri alır ve hata gösterir — aksi halde checkbox ekranda işaretli görünmeye devam edip
  // sayfa yenilenince veritabanındaki gerçek (işaretlenmemiş) durum ortaya çıkardı.
  async function patchReviewed(items: Array<{ postingNumber: string; offerId: string }>, value: boolean): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/shipping-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, reviewed: value }),
      });
      if (!res.ok) throw new Error();
      return true;
    } catch {
      setError("Kaydedilemedi, tekrar deneyin");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleCheck(row: PnlRow, checked: boolean) {
    if (checked) {
      // Aynı üründe (offerId), kargo ücreti işaretlenenle aynı ya da daha düşük olan diğer
      // satırlar da otomatik "incelendi" sayılır — kullanıcı en yüksek ücretli örneği kontrol
      // ettikten sonra düşük ücretlileri tek tek gözden geçirmesin diye (2026-09-09, kullanıcı talebi).
      const threshold = row.realShippingRub ?? 0;
      const matches = rows.filter(
        (r) => r.offerId === row.offerId && r.realShippingRub != null && r.realShippingRub <= threshold,
      );
      setReviewed((prev) => {
        const next = new Set(prev);
        for (const m of matches) next.add(key(m));
        return next;
      });
      const ok = await patchReviewed(matches.map((m) => ({ postingNumber: m.postingNumber, offerId: m.offerId })), true);
      if (!ok) {
        setReviewed((prev) => {
          const next = new Set(prev);
          for (const m of matches) next.delete(key(m));
          return next;
        });
      }
    } else {
      setReviewed((prev) => {
        const next = new Set(prev);
        next.delete(key(row));
        return next;
      });
      const ok = await patchReviewed([{ postingNumber: row.postingNumber, offerId: row.offerId }], false);
      if (!ok) {
        setReviewed((prev) => new Set(prev).add(key(row)));
      }
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="hint">
          {visibleRows.length} / {rows.length} kalem gösteriliyor{saving && " — kaydediliyor..."}
          {error && <span style={{ color: "var(--danger)", marginLeft: 8 }}>{error}</span>}
        </div>
        <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} />
          İncelenmişleri de göster
        </label>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th></th>
              <th style={{ whiteSpace: "nowrap" }}>Posting No</th>
              <th style={{ whiteSpace: "nowrap" }}>Tarih</th>
              <th>Ürün</th>
              <th style={{ whiteSpace: "nowrap" }}>Adet</th>
              <th style={{ whiteSpace: "nowrap" }}>Alış</th>
              <th style={{ whiteSpace: "nowrap" }}>Gerçek Kargo (₽)</th>
              <th style={{ whiteSpace: "nowrap" }}>Tahmini Ağırlık</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => {
              const isReviewed = reviewed.has(key(row));
              return (
                <tr key={`${key(row)}-${i}`} style={isReviewed ? { opacity: 0.5 } : undefined}>
                  <td>
                    <input type="checkbox" checked={isReviewed} onChange={(e) => handleCheck(row, e.target.checked)} />
                  </td>
                  <td>
                    <Link href={`/orders/${row.postingNumber}`}>{row.postingNumber}</Link>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{row.orderDate ?? "-"}</td>
                  <td>
                    <div>
                      <CopyableProductName name={row.productName} nameRu={row.productNameRu} />
                    </div>
                    <div className="hint">{row.offerId}</div>
                  </td>
                  <td>{row.quantity}</td>
                  <td>{row.unitCostPrice != null ? fmtMoney(row.unitCostPrice * row.quantity) : <CostPriceCell offerId={row.offerId} />}</td>
                  <td className="hint" style={{ whiteSpace: "nowrap" }}>
                    {row.approximateShippingSplit ? "~" : ""}
                    ₽{(row.realShippingRub ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                    {row.approximateShippingSplit && (
                      <span title="Posting'te birden fazla ürün var, tutar satış payına göre paylaştırıldı"> *</span>
                    )}
                  </td>
                  <td className="hint" style={{ whiteSpace: "nowrap" }}>
                    {row.cargoWeightGrams != null ? `${Math.round(row.cargoWeightGrams)}g` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
