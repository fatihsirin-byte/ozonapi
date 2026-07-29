import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct } from "@/modules/products/products.service";
import { ProductEditForm } from "./ProductEditForm";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const product = await getProduct(offerId);

  if (!product) {
    notFound();
  }

  // importTaskId BigInt — Client Component'e prop olarak JSON-serialize edilemez, string'e çeviriyoruz.
  const serializedProduct = { ...product, importTaskId: product.importTaskId?.toString() ?? null };

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
      <ProductEditForm product={serializedProduct} />
    </div>
  );
}
