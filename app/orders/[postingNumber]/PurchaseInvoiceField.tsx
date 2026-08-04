"use client";

import { useState } from "react";

export function PurchaseInvoiceField({
  postingNumber,
  initialValue,
}: {
  postingNumber: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);

  async function save(newValue: string) {
    setSaving(true);
    try {
      await fetch(`/api/orders/${encodeURIComponent(postingNumber)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseInvoiceNumber: newValue || null }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="hint">Alış Fatura No</div>
      <input
        type="text"
        style={{ width: "100%" }}
        value={value}
        placeholder="tedarikçi fatura no"
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        disabled={saving}
      />
    </div>
  );
}
