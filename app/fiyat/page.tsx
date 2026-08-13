import { Suspense } from "react";
import { PriceList } from "./PriceList";

export default function FiyatPage() {
  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Fiyat</h1>
      </div>
      <Suspense>
        <PriceList />
      </Suspense>
    </div>
  );
}
