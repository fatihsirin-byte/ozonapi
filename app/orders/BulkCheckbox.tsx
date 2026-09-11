"use client";

import { useBulkShip } from "./BulkShipContext";

export function BulkCheckbox({
  postingNumber,
  totalQuantity,
  weightWarning,
}: {
  postingNumber: string;
  totalQuantity: number;
  weightWarning: boolean;
}) {
  const { isSelected, toggle } = useBulkShip();
  return (
    <input
      type="checkbox"
      checked={isSelected(postingNumber)}
      onChange={(e) => toggle({ postingNumber, totalQuantity, weightWarning }, e.target.checked)}
      title={weightWarning ? "500g altı depo + birden fazla ürün — paketlerken uyarı gösterilecek" : undefined}
    />
  );
}
