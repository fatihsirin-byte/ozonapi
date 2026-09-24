"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface BulkShipEntry {
  postingNumber: string;
  totalQuantity: number;
  weightWarning: boolean;
  // Checkbox artık HER durumdaki siparişte çıktığı için (2026-09-23, kullanıcı talebi) — hangi
  // toplu işlemin (paketle/etiket/fatura+ase) bu siparişle uyumlu olduğunu belirlemek için gerekli,
  // bkz. BulkShipBar.tsx.
  status: string;
  locked: boolean;
}

interface BulkShipContextValue {
  selected: Map<string, BulkShipEntry>;
  toggle: (entry: BulkShipEntry, checked: boolean) => void;
  clear: () => void;
  isSelected: (postingNumber: string) => boolean;
  // "Tümünü Seç" checkbox'ı için — 2026-09-23, kullanıcı talebi: "seç'e tümü butonu ekle". Sadece
  // GÖRÜNÜR sayfadaki siparişleri seçer (server-side pagination, bkz. page.tsx PageLinkPagination)
  // — diğer sayfalardaki siparişlere dokunmaz.
  selectAll: (entries: BulkShipEntry[]) => void;
}

const BulkShipContext = createContext<BulkShipContextValue | null>(null);

// Toplu paketleme seçimi (checkbox'lar + "Toplu Paketle" barı) tabloyu SERVER component olarak
// bırakabilmek için ayrı bir context'te tutuluyor — sadece checkbox hücreleri ve alttaki bar
// client, satırların geri kalanı (resim, link, kâr hesabı vs.) hiç değişmeden server-render
// kalıyor (2026-09-11, kullanıcı talebi: "toplu paketlemeyi aktif et").
export function BulkShipProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Map<string, BulkShipEntry>>(new Map());

  const value = useMemo<BulkShipContextValue>(
    () => ({
      selected,
      toggle: (entry, checked) => {
        setSelected((prev) => {
          const next = new Map(prev);
          if (checked) next.set(entry.postingNumber, entry);
          else next.delete(entry.postingNumber);
          return next;
        });
      },
      clear: () => setSelected(new Map()),
      isSelected: (postingNumber) => selected.has(postingNumber),
      selectAll: (entries) => setSelected(new Map(entries.map((e) => [e.postingNumber, e]))),
    }),
    [selected],
  );

  return <BulkShipContext.Provider value={value}>{children}</BulkShipContext.Provider>;
}

export function useBulkShip() {
  const ctx = useContext(BulkShipContext);
  if (!ctx) throw new Error("useBulkShip, BulkShipProvider içinde kullanılmalı");
  return ctx;
}
