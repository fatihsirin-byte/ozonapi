import Link from "next/link";
import { listAllProducts } from "@/modules/products/products.service";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await listAllProducts();

  return (
    <div className="page">
      <div className="topbar">
        <h1>Ürünler</h1>
        <Link href="/products/new">
          <button className="btn-primary">+ Yeni Ürün</button>
        </Link>
      </div>

      <div className="card">
        {products.length === 0 ? (
          <div className="empty-state">Henüz ürün yok. "Yeni Ürün" ile ilk ürününüzü ekleyin.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Ad</th>
                <th>Fiyat</th>
                <th>Durum</th>
                <th>Hata</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.offerId}</td>
                  <td>{p.name}</td>
                  <td>
                    {p.price} {p.currencyCode}
                  </td>
                  <td>
                    <span className={`badge ${p.status}`}>{p.status}</span>
                  </td>
                  <td style={{ color: "var(--danger)", fontSize: 12 }}>{p.lastError ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
