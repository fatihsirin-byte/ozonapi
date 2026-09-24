"use client";

import { useBulkShip, type BulkShipEntry } from "./BulkShipContext";

// "Seç" sütunu başlığındaki tümünü seç/kaldır checkbox'ı (2026-09-23, kullanıcı talebi) — SADECE bu
// sayfada (server-side pagination) görünen siparişleri kapsar, indeterminate durumu (bazısı seçili)
// görsel olarak "kısmi seçili" gösterir.
export function SelectAllCheckbox({ entries }: { entries: BulkShipEntry[] }) {
  const { selected, selectAll, clear } = useBulkShip();
  const selectedOnPage = entries.filter((e) => selected.has(e.postingNumber)).length;
  const allSelected = entries.length > 0 && selectedOnPage === entries.length;
  const someSelected = selectedOnPage > 0 && !allSelected;

  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected;
      }}
      onChange={(e) => (e.target.checked ? selectAll(entries) : clear())}
      title="Bu sayfadaki tüm siparişleri seç/kaldır"
      disabled={entries.length === 0}
    />
  );
}
