import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct } from "@/modules/products/products.service";
import { prisma } from "@/db/prisma";
import { decodeOfferId } from "@/utils/decodeOfferId";
import { ProductPageTabs } from "./ProductPageTabs";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId: rawOfferId } = await params;
  const offerId = decodeOfferId(rawOfferId);
  if (!offerId) {
    notFound();
  }
  const product = await getProduct(offerId);
  if (!product) {
    notFound();
  }

  // importTaskId BigInt — Client Component'e prop olarak JSON-serialize edilemez, string'e çeviriyoruz.
  const serializedProduct = { ...product, importTaskId: product.importTaskId?.toString() ?? null };

  // Shopify orijinal görünümü (Ozon ve toptantr sekmelerinin ikisinde de üstte sabit): görseller, orijinal
  // isim/açıklama ve varyantlar. Kaynak Shopify'dır; burada hiçbir şey Shopify'a yazılmaz.
  const siblings = product.shopifyHandle
    ? await prisma.product.findMany({
        where: { shopifyHandle: product.shopifyHandle },
        orderBy: { variantPosition: "asc" },
        select: { offerId: true, name: true, shopifyStock: true, images: true, originalImages: true, descriptionHtml: true },
      })
    : [];
  const toUrls = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const gallery = [...new Set([...toUrls(product.images), ...toUrls(product.originalImages)])].slice(0, 12);
  const descriptionHtml = product.descriptionHtml ?? siblings.find((v) => v.descriptionHtml)?.descriptionHtml ?? null;

  return (
    <div className="page">
      <div className="topbar">
        <h1>{product.name}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/products/new?cloneFrom=${encodeURIComponent(offerId)}`}>
            <button className="btn-secondary">Bu üründen kopyala</button>
          </Link>
          <Link href="/products">
            <button className="btn-secondary">← Listeye dön</button>
          </Link>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <label>Shopify Orijinali</label>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{product.name}</div>
        {gallery.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {gallery.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" loading="lazy" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 6 }} />
            ))}
          </div>
        )}
        {descriptionHtml && (
          <div
            className="hint"
            style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 10, marginBottom: 12 }}
            dangerouslySetInnerHTML={{ __html: descriptionHtml }}
          />
        )}
        {siblings.length > 1 && (
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Varyant adı</th>
                <th style={{ textAlign: "right" }}>Shopify stok</th>
              </tr>
            </thead>
            <tbody>
              {siblings.map((v) => (
                <tr key={v.offerId}>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{v.offerId}</td>
                  <td>{v.name}</td>
                  <td style={{ textAlign: "right" }}>{v.shopifyStock ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ProductPageTabs product={serializedProduct} offerId={offerId} shopifyHandle={product.shopifyHandle} />
    </div>
  );
}
