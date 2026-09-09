"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { computeRowMetrics, estimateShippingForWeight, type PnlRow } from "@/modules/finance/pnl-report.service";
import { CopyableProductName } from "./CopyableProductName";
import { OrderDetailModal } from "./OrderDetailModal";

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

type SortKey = "orderDate" | "status" | "productName" | "quantity" | "totalSale" | "totalCost" | "profit" | "marginPct";

interface Enriched {
  row: PnlRow;
  totalSale: number;
  totalCost: number | null;
  profit: number | null;
  marginPct: number | null;
  warning: string | null;
  estimatedShippingUsd: number | null;
  shippingDiff: number | null;
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "orderDate", label: "Tarih" },
  { key: "status", label: "Durum" },
  { key: "productName", label: "Ürün" },
  { key: "quantity", label: "Adet" },
  { key: "totalSale", label: "Satış" },
  { key: "totalCost", label: "Alış" },
  { key: "profit", label: "Net Kâr" },
  { key: "marginPct", label: "Marj" },
];

function sortValue(e: Enriched, key: SortKey): string | number {
  switch (key) {
    case "orderDate":
      return e.row.orderDate ?? "";
    case "status":
      return e.row.status;
    case "productName":
      return e.row.productName;
    case "quantity":
      return e.row.quantity;
    case "totalSale":
      return e.totalSale;
    case "totalCost":
      return e.totalCost ?? -Infinity;
    case "profit":
      return e.profit ?? -Infinity;
    case "marginPct":
      return e.marginPct ?? -Infinity;
  }
}

// Ana kâr/zarar tablosu — başlıklara tıklayınca sıralama, üstte arama kutusuyla ürün/offerId/
// posting no filtresi (2026-09-09, kullanıcı talebi: "başlıklara tıklanabilsin, searchbar olsun").
export function PnlMainTable({ rows }: { rows: PnlRow[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("orderDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openPosting, setOpenPosting] = useState<string | null>(null);

  const enriched = useMemo<Enriched[]>(
    () =>
      rows.map((row) => {
        const m = computeRowMetrics(row);
        const estimatedShippingUsd =
          row.cargoWeightGrams != null ? estimateShippingForWeight(row.cargoWeightGrams * row.quantity) : null;
        const shippingDiff =
          row.realShippingUsd != null && estimatedShippingUsd != null ? row.realShippingUsd - estimatedShippingUsd : null;
        return {
          row,
          totalSale: m.totalSale,
          totalCost: m.totalCost,
          profit: m.profit,
          marginPct: m.marginPct,
          warning: m.warning,
          estimatedShippingUsd,
          shippingDiff,
        };
      }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enriched;
    return enriched.filter(
      (e) =>
        e.row.productName.toLowerCase().includes(q) ||
        (e.row.productNameRu?.toLowerCase().includes(q) ?? false) ||
        e.row.offerId.toLowerCase().includes(q) ||
        e.row.postingNumber.toLowerCase().includes(q),
    );
  }, [enriched, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "tr");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  // Aynı siparişe (postingNumber) ait birden fazla ürün varsa şu an sıralamada bitişik olduğu
  // sürece görsel olarak birleştiriliyor — posting no/tarih/durum sadece grubun ilk satırında
  // gösteriliyor (2026-09-09, kullanıcı talebi: "2'li 3'lüleri farklı satırlar aynı trackingler
  // gibi oluyor, tracking boş bırakabilirsin"). Sıralama posting'leri dağıtırsa (ör. ürün adına
  // göre sıralanınca) grup doğal olarak bozulur, o zaman her satır kendi posting no'sunu gösterir.
  const openOrderItems = useMemo(() => (openPosting ? enriched.filter((e) => e.row.postingNumber === openPosting).map((e) => e.row) : []), [enriched, openPosting]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Ürün adı, offer ID ya da posting no ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", maxWidth: 420 }}
        />
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">Arama sonucu bulunamadı.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ whiteSpace: "nowrap" }}>Posting No</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    style={{ whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
                    onClick={() => handleSort(col.key)}
                    title="Sıralamak için tıkla"
                  >
                    {col.label}
                    {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
                  </th>
                ))}
                <th style={{ whiteSpace: "nowrap" }}>Ağırlık / Kargo</th>
                <th style={{ whiteSpace: "nowrap" }}>Tahmini Kargo (Ağırlıktan)</th>
                <th style={{ whiteSpace: "nowrap" }}>Fark (Gerçek − Tahmini)</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e, i) => {
                const { row } = e;
                const isFirstOfGroup = i === 0 || sorted[i - 1].row.postingNumber !== row.postingNumber;
                const groupSize = sorted.filter((x) => x.row.postingNumber === row.postingNumber).length;
                return (
                  <tr key={`${row.postingNumber}-${row.offerId}-${i}`} style={!isFirstOfGroup ? { borderTop: "none" } : undefined}>
                    <td>
                      {isFirstOfGroup ? (
                        <button
                          type="button"
                          onClick={() => setOpenPosting(row.postingNumber)}
                          className="hint"
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "inherit", textDecoration: "underline" }}
                        >
                          {row.postingNumber}
                          {groupSize > 1 && ` (${groupSize} ürün)`}
                        </button>
                      ) : (
                        <span className="hint">↳</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{isFirstOfGroup ? row.orderDate ?? "-" : ""}</td>
                    <td>{isFirstOfGroup && <span className="badge pending">{row.status}</span>}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {row.productImage && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.productImage}
                            alt=""
                            width={32}
                            height={32}
                            style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
                          />
                        )}
                        <div>
                          <div>
                            <CopyableProductName name={row.productName} nameRu={row.productNameRu} />
                          </div>
                          <div className="hint">
                            {row.offerId}
                            {row.ozonSku && (
                              <>
                                {" · "}
                                <a href={`https://www.ozon.ru/context/detail/id/${row.ozonSku}/`} target="_blank" rel="noopener noreferrer">
                                  Ozon'da gör ↗
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{row.quantity}</td>
                    <td>{fmtMoney(e.totalSale)}</td>
                    <td>
                      {e.totalCost != null ? (
                        fmtMoney(e.totalCost)
                      ) : (
                        <Link href="/pnl?missingCost=1" className="hint">
                          eksik
                        </Link>
                      )}
                    </td>
                    <td style={{ color: e.profit == null ? undefined : e.profit >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {e.profit != null ? fmtMoney(e.profit) : <span className="hint" title={e.warning ?? undefined}>{e.warning ?? "-"}</span>}
                    </td>
                    <td>{fmtPct(e.marginPct)}</td>
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
                    <td style={{ whiteSpace: "nowrap", fontSize: 15 }}>
                      {e.estimatedShippingUsd != null ? fmtMoney(e.estimatedShippingUsd) : "-"}
                    </td>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        fontSize: 16,
                        fontWeight: 600,
                        color: e.shippingDiff == null ? undefined : e.shippingDiff > 0 ? "var(--danger)" : "var(--success)",
                      }}
                    >
                      {e.shippingDiff != null ? `${e.shippingDiff >= 0 ? "+" : ""}${fmtMoney(e.shippingDiff)}` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openPosting && openOrderItems.length > 0 && (
        <OrderDetailModal
          postingNumber={openPosting}
          items={openOrderItems}
          allRows={rows}
          onClose={() => setOpenPosting(null)}
        />
      )}
    </div>
  );
}
