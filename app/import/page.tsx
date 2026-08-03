import { Suspense } from "react";
import Link from "next/link";
import { StagingList } from "./StagingList";

export default function ImportPage() {
  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Shopify İçe Aktarım</h1>
        <Link href="/products">
          <button className="btn-secondary">← Ürünlere dön</button>
        </Link>
      </div>
      <Suspense>
        <StagingList />
      </Suspense>
    </div>
  );
}
