"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBulkShip } from "./BulkShipContext";
import { BulkShipWizard } from "./BulkShipWizard";

export function BulkShipBar() {
  const router = useRouter();
  const { selected, clear } = useBulkShip();
  const [wizardOpen, setWizardOpen] = useState(false);

  if (selected.size === 0 && !wizardOpen) return null;

  const entries = [...selected.values()];
  const warnedCount = entries.filter((e) => e.weightWarning).length;

  function finish() {
    setWizardOpen(false);
    clear();
    router.refresh();
  }

  return (
    <>
      <div
        className="card"
        style={{
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 12,
          position: "sticky",
          top: 8,
          zIndex: 10,
        }}
      >
        <span>
          <strong>{selected.size}</strong> sipariş seçildi
          {warnedCount > 0 && (
            <span className="hint" style={{ color: "var(--danger)", marginLeft: 6 }}>
              ({warnedCount} tanesi 500g uyarılı)
            </span>
          )}
        </span>
        <button type="button" className="btn-primary" onClick={() => setWizardOpen(true)} disabled={selected.size === 0}>
          Toplu Paketle
        </button>
        <button type="button" className="btn-secondary" onClick={clear}>
          Seçimi Temizle
        </button>
      </div>
      {wizardOpen && entries.length > 0 && <BulkShipWizard entries={entries} onFinish={finish} />}
    </>
  );
}
