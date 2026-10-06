import { searchProductsForHsCode, listUsedProductCategoryIds } from "@/modules/products/products.service";
import { getFlatCategories } from "@/ozon/category-cache";
import { parsePageParam } from "@/utils/pagination";
import { HsKodSearchBar, type CategoryOption } from "./HsKodSearchBar";
import { HsCodeInput } from "./HsCodeInput";
import { PageLinkPagination } from "../orders/PageLinkPagination";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// Ozon HS/GTİP kodu isteyen ASE (gümrük) entegrasyonu için — kullanıcı talebi (2026-09-25):
// "yeni bi ekran yapacaz, türkçe adıyla search rusca adıyla search sku ile search destekleyecek
// sadece ürün bilgisi ve hs kod kategori filtresi de olcak ekrandan copy paste ile otomatik hs
// kaydetme". Ürünün mevcut GTİP override'ını (bkz. Product.gtipOverride, HsCodeInput.tsx) hızlıca
// arayıp elle/yapıştırarak düzeltmek için — InvoiceAndAseButton'daki HS popup'ı SADECE fatura
// akışı sırasında, sipariş bazlı devreye giriyordu; bu ekran ise ürün kataloğunun TAMAMINI, önden,
// bağımsız olarak taramak/tamamlamak için.
export default async function HsKodPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; type?: string; missing?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const descriptionCategoryId = params.cat ? Number(params.cat) : undefined;
  const typeId = params.type ? Number(params.type) : undefined;
  const onlyMissing = params.missing === "1";

  const [{ items, total }, usedCategoryIds, flatCategories] = await Promise.all([
    searchProductsForHsCode({
      q: params.q,
      descriptionCategoryId: Number.isFinite(descriptionCategoryId) ? descriptionCategoryId : undefined,
      typeId: Number.isFinite(typeId) ? typeId : undefined,
      onlyMissing,
      page,
      pageSize: PAGE_SIZE,
    }),
    listUsedProductCategoryIds(),
    getFlatCategories(),
  ]);

  const categoryByKey = new Map(flatCategories.map((c) => [`${c.descriptionCategoryId}:${c.typeId}`, c]));
  const categories: CategoryOption[] = usedCategoryIds
    .map((c) => {
      const match = categoryByKey.get(`${c.descriptionCategoryId}:${c.typeId}`);
      return {
        descriptionCategoryId: c.descriptionCategoryId,
        typeId: c.typeId,
        label: match ? match.path : `Kategori ${c.descriptionCategoryId}/${c.typeId}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const queryPrefix = (() => {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (params.cat) p.set("cat", params.cat);
    if (params.type) p.set("type", params.type);
    if (onlyMissing) p.set("missing", "1");
    const s = p.toString();
    return s ? `${s}&` : "";
  })();

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>HS Kod Arama</h1>
      </div>
      <div className="hint" style={{ marginBottom: 12 }}>
        <strong>{total}</strong> ürün bulundu.
      </div>
      <div style={{ marginBottom: 16 }}>
        <HsKodSearchBar categories={categories} />
      </div>
      {items.length === 0 ? (
        <div className="empty-state">Eşleşen ürün yok.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Ürün</th>
              <th>SKU</th>
              <th>Kategori</th>
              <th>HS Kodu</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const category =
                p.descriptionCategoryId != null && p.typeId != null
                  ? categoryByKey.get(`${p.descriptionCategoryId}:${p.typeId}`)?.path
                  : null;
              return (
                <tr key={p.offerId}>
                  <td style={{ width: 48 }}>
                    {p.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 4 }} />
                    )}
                  </td>
                  <td>
                    <div>{p.name}</div>
                    {p.nameRu && (
                      <div className="hint" style={{ fontSize: 12 }}>
                        {p.nameRu}
                      </div>
                    )}
                  </td>
                  <td>{p.offerId}</td>
                  <td className="hint" style={{ fontSize: 12 }}>
                    {category ?? "-"}
                  </td>
                  <td>
                    <HsCodeInput offerId={p.offerId} initialValue={p.gtipOverride} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {totalPages > 1 && (
        <PageLinkPagination page={page} totalPages={totalPages} hrefForPage={(p) => `/hs-kod?${queryPrefix}page=${p}`} />
      )}
    </div>
  );
}
