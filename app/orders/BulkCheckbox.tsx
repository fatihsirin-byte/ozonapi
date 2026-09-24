"use client";

import { useBulkShip } from "./BulkShipContext";

export function BulkCheckbox({
  postingNumber,
  totalQuantity,
  weightWarning,
  status,
  locked,
}: {
  postingNumber: string;
  totalQuantity: number;
  weightWarning: boolean;
  status: string;
  locked: boolean;
}) {
  const { isSelected, toggle } = useBulkShip();
  return (
    <input
      type="checkbox"
      checked={isSelected(postingNumber)}
      onChange={(e) => toggle({ postingNumber, totalQuantity, weightWarning, status, locked }, e.target.checked)}
      title={weightWarning ? "Ağırlık uyarısı olan sipariş — toplu paketlerken ayrıca sorulacak" : undefined}
    />
  );
}
