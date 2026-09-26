"use client";

import { useState } from "react";
import { ProductEditForm } from "./ProductEditForm";
import { ProductSalesChart } from "./ProductSalesChart";
import { ToptantrPanel } from "../../import/[handle]/ToptantrPanel";

// Ürün detay sayfasında Ozon/toptantr sekmeleri — /import/[handle] sayfasındaki (staging,
// henüz Ozon'a hiç gönderilmemiş ürünler) aynı desenin canlı (zaten Ozon'a gönderilmiş) ürünler
// tarafındaki karşılığı (2026-09-27, kullanıcı talebi).
export function ProductPageTabs({
  product,
  offerId,
  shopifyHandle,
}: {
  product: Parameters<typeof ProductEditForm>[0]["product"];
  offerId: string;
  shopifyHandle: string | null;
}) {
  const [activeTab, setActiveTab] = useState<"ozon" | "toptantr">("ozon");

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={activeTab === "ozon" ? "btn-primary" : "btn-secondary"}
          onClick={() => setActiveTab("ozon")}
        >
          Ozon
        </button>
        <button
          type="button"
          className={activeTab === "toptantr" ? "btn-primary" : "btn-secondary"}
          onClick={() => setActiveTab("toptantr")}
        >
          toptantr
        </button>
      </div>

      {activeTab === "ozon" && (
        <>
          <ProductEditForm product={product} />
          <ProductSalesChart offerId={offerId} />
        </>
      )}

      {activeTab === "toptantr" &&
        (shopifyHandle ? (
          <ToptantrPanel handle={shopifyHandle} />
        ) : (
          <div className="card">
            Bu ürünün bir Shopify handle&apos;ı yok (muhtemelen elle veya Ozon&apos;dan içe aktarıldı) —
            toptantr&apos;a bağlanamaz.
          </div>
        ))}
    </>
  );
}
