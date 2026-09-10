import Link from "next/link";
import { buildPageList } from "@/utils/pagination";

export function PageLinkPagination({
  page,
  totalPages,
  hrefForPage,
}: {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  const pages = buildPageList(page, totalPages);

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
      {page > 1 && (
        <Link href={hrefForPage(page - 1)}>
          <button className="btn-secondary">← Önceki</button>
        </Link>
      )}
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`e-${i}`} className="hint" style={{ padding: "0 4px" }}>
            …
          </span>
        ) : (
          <Link key={p} href={hrefForPage(p)}>
            <button className={`btn-secondary${p === page ? " active" : ""}`}>{p}</button>
          </Link>
        ),
      )}
      {page < totalPages && (
        <Link href={hrefForPage(page + 1)}>
          <button className="btn-secondary">Sonraki →</button>
        </Link>
      )}
    </div>
  );
}
