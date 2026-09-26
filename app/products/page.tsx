import Link from "next/link";
import { listAllProducts, getToptantrConnectedHandleSet } from "@/modules/products/products.service";
import { productPath } from "@/utils/decodeOfferId";
import { ImportProductForm } from "./ImportProductForm";
import { ProductsSearchBar } from "./ProductsSearchBar";
import { PageLinkPagination } from "../orders/PageLinkPagination";
import { parsePageParam } from "@/utils/pagination";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; marketplace?: string }>;
}) {
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const marketplace =
    params.marketplace === "ozon" || params.marketplace === "toptantr" || params.marketplace === "both"
      ? params.marketplace
      : undefined;
  const [{ products, total }, toptantrHandles] = await Promise.all([
    listAllProducts({
      search: params.q,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      marketplace,
    }),
    getToptantrConnectedHandleSet(),
  ]);
  const pageQuery = `${params.q ? `q=${encodeURIComponent(params.q)}&` : ""}${marketplace ? `marketplace=${marketplace}&` : ""}`;

  return (
    <div className="page">
      <div className="topbar">
        <h1>Ürünler</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <ImportProductForm />
          <Link href="/products/new">
            <button className="btn-primary">+ Yeni Ürün</button>
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <ProductsSearchBar />
      </div>

      <div className="card">
        {products.length === 0 ? (
          <div className="empty-state">
            {params.q ? `"${params.q}" için sonuç bulunamadı.` : 'Henüz ürün yok. "Yeni Ürün" ile ilk ürününüzü ekleyin.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Ad</th>
                <th>Fiyat</th>
                <th>Durum</th>
                <th>Bağlantı</th>
                <th>Hata</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const onToptantr = p.shopifyHandle ? toptantrHandles.has(p.shopifyHandle) : false;
                const onOzon = Boolean(p.ozonProductId);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={productPath(p.offerId)}>{p.offerId}</Link>
                    </td>
                    <td>{p.name}</td>
                    <td>
                      {p.price} {p.currencyCode}
                    </td>
                    <td>
                      <span className={`badge ${p.status}`}>{p.status}</span>
                    </td>
                    <td style={{ display: "flex", gap: 4 }}>
                      {onOzon && <span className="badge imported">Ozon</span>}
                      {onToptantr && <span className="badge success">toptantr</span>}
                      {!onOzon && !onToptantr && <span className="hint">—</span>}
                    </td>
                    <td style={{ color: "var(--danger)", fontSize: 12 }}>{p.lastError ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {total > PAGE_SIZE && (
          <PageLinkPagination
            page={page}
            totalPages={Math.ceil(total / PAGE_SIZE)}
            hrefForPage={(p) => `/products?${pageQuery}page=${p}`}
          />
        )}
      </div>
    </div>
  );
}
