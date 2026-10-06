import { listProductsMissingRealWeight } from "@/modules/products/products.service";
import { parsePageParam } from "@/utils/pagination";
import { RealWeightInput } from "../orders/[postingNumber]/RealWeightInput";
import { PageLinkPagination } from "../orders/PageLinkPagination";
import { CopyablePostingNumber } from "./CopyablePostingNumber";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// Kullanıcı talebi (2026-09-25): "gerçek ağırlığı girilmeyenler sekmesi aç SATIŞ olup gerçek
// ağırlığını girmediğimiz ürünleri göstersin. hiç satış olmayanları göstermesin." — sipariş
// sayfasındaki (RealWeightInput.tsx, orada sipariş bazlı kullanılıyordu) AYNI "gerçek ağırlık gir"
// kontrolünü, ÜRÜN kataloğunun tamamını önden taramak için burada tekrar kullanıyoruz — endpoint
// zaten ürün bazlı (bkz. app/api/products/[offerId]/confirm-weight/route.ts), sipariş context'ine
// ihtiyaç duymuyor.
export default async function AgirlikBekleyenPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = parsePageParam(params.page);
  const { items, total } = await listProductsMissingRealWeight({ page, pageSize: PAGE_SIZE });
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Gerçek Ağırlık Bekleyenler</h1>
      </div>
      <div className="hint" style={{ marginBottom: 12 }}>
        En az bir kez satılmış ama gerçek (tartılmış) ağırlığı hâlâ girilmemiş <strong>{total}</strong> ürün var.
      </div>
      {items.length === 0 ? (
        <div className="empty-state">Bekleyen ürün yok — satılmış ürünlerin hepsinin gerçek ağırlığı girilmiş.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Ürün</th>
              <th>SKU</th>
              <th>Örnek Sipariş No</th>
              <th>Kaç Kez Satıldı</th>
              <th>Kayıtlı Ağırlık</th>
              <th>Gerçek Ağırlık</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
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
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {p.samplePostingNumbers.map((posting) => (
                      <CopyablePostingNumber key={posting} value={posting} />
                    ))}
                  </div>
                </td>
                <td>{p.soldCount}</td>
                <td className="hint">{p.weightGrams != null ? `${p.weightGrams}g` : "-"}</td>
                <td>
                  <RealWeightInput
                    offerId={p.offerId}
                    initialConfirmed={false}
                    initialWeightGrams={p.weightGrams}
                    initialPrice={p.price}
                    currentBillingWeightGrams={null}
                    currentWeightSourceLabel=""
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {totalPages > 1 && (
        <PageLinkPagination page={page} totalPages={totalPages} hrefForPage={(p) => `/agirlik-bekleyen?page=${p}`} />
      )}
    </div>
  );
}
