import Link from "next/link";
import { listAllProducts, getToptantrConnectedHandleSet, getVariantCountsByHandle } from "@/modules/products/products.service";
import { productPath } from "@/utils/decodeOfferId";
import { ImportProductForm } from "./ImportProductForm";
import { ShopifyImportButton } from "./ShopifyImportButton";
import { ProductsSearchBar } from "./ProductsSearchBar";
import { PageLinkPagination } from "../orders/PageLinkPagination";
import { parsePageParam } from "@/utils/pagination";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; marketplace?: string; stock?: string; variants?: string }>;
}) {
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const marketplace =
    params.marketplace === "ozon" || params.marketplace === "toptantr" || params.marketplace === "both" || params.marketplace === "none"
      ? params.marketplace
      : undefined;
  // Varsayılan: stokta olanlar (stok adedine göre çoktan aza). "all" açıkça seçilirse filtre yok.
  const stockParam = params.stock === "in" || params.stock === "out" || params.stock === "all" ? params.stock : "in";
  const stock = stockParam === "all" ? undefined : stockParam;
  const variantsParam = Number(params.variants);
  const variants = Number.isInteger(variantsParam) && variantsParam >= 1 && variantsParam <= 5 ? variantsParam : undefined;
  const [{ products, total }, toptantrHandles] = await Promise.all([
    listAllProducts({
      stock,
      variants,
      search: params.q,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      marketplace,
    }),
    getToptantrConnectedHandleSet(),
  ]);
  const variantCounts = await getVariantCountsByHandle([...new Set(products.map((p) => p.shopifyHandle).filter((h): h is string => Boolean(h)))]);
  const pageQuery = `${params.q ? `q=${encodeURIComponent(params.q)}&` : ""}${marketplace ? `marketplace=${marketplace}&` : ""}${params.stock ? `stock=${stockParam}&` : ""}${variants ? `variants=${variants}&` : ""}`;

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Ürünler</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <ImportProductForm />
          <ShopifyImportButton />
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
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", tableLayout: "fixed", minWidth: 1140 }}>
            <colgroup>
              <col style={{ width: 64 }} />
              <col style={{ width: 210 }} />
              <col />
              <col style={{ width: 80 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead>
              <tr>
                <th></th>
                <th style={{ whiteSpace: "nowrap" }}>SKU</th>
                <th>Ad</th>
                <th style={{ whiteSpace: "nowrap", textAlign: "center" }}>Varyant</th>
                <th style={{ whiteSpace: "nowrap", textAlign: "right" }}>Satış</th>
                <th style={{ whiteSpace: "nowrap", textAlign: "right" }}>Maliyet</th>
                <th style={{ whiteSpace: "nowrap", textAlign: "right" }}>Stok</th>
                <th style={{ whiteSpace: "nowrap" }}>Durum</th>
                <th style={{ whiteSpace: "nowrap" }}>Bağlantı</th>
                <th>Hata</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const onToptantr = p.shopifyHandle ? toptantrHandles.has(p.shopifyHandle) : false;
                const onOzon = Boolean(p.ozonProductId);
                const thumb = Array.isArray(p.images) && typeof p.images[0] === "string" ? (p.images[0] as string) : null;
                const variantCount = p.shopifyHandle ? (variantCounts.get(p.shopifyHandle) ?? 1) : 1;
                return (
                  <tr key={p.id}>
                    <td>
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" loading="lazy" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, display: "block" }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 6, background: "var(--surface-2, #1f2128)" }} />
                      )}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}>
                      <Link href={productPath(p.offerId)}>{p.offerId}</Link>
                    </td>
                    <td style={{ lineHeight: 1.35 }}>{p.name}</td>
                    <td style={{ textAlign: "center" }}>
                      <span className="badge" title={`${variantCount} varyant`}>{variantCount}</span>
                    </td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {p.price} {p.currencyCode}
                    </td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>{p.costPrice ? `${p.costPrice} ${p.currencyCode}` : <span className="hint">—</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      {p.shopifyStock == null ? (
                        <span className="hint">—</span>
                      ) : (
                        <span style={{ color: p.shopifyStock > 0 ? undefined : "var(--danger)", fontWeight: 600 }}>{p.shopifyStock}</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${p.status}`}>{p.status}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {onOzon && <span className="badge imported">Ozon</span>}
                        {onToptantr && <span className="badge success">toptantr</span>}
                        {!onOzon && !onToptantr && <span className="hint">—</span>}
                      </div>
                    </td>
                    <td style={{ color: "var(--danger)", fontSize: 12 }}>{p.lastError ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
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
