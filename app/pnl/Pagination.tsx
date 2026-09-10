"use client";

import { buildPageList } from "@/utils/pagination";

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const pages = buildPageList(page, totalPages);

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
      {page > 1 && (
        <button type="button" className="btn-secondary" onClick={() => onPageChange(page - 1)}>
          ← Önceki
        </button>
      )}
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`e-${i}`} className="hint" style={{ padding: "0 4px" }}>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={`btn-secondary${p === page ? " active" : ""}`}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ),
      )}
      {page < totalPages && (
        <button type="button" className="btn-secondary" onClick={() => onPageChange(page + 1)}>
          Sonraki →
        </button>
      )}
    </div>
  );
}
