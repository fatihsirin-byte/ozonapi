"use client";

import { useEffect, useState } from "react";

interface EtgbData {
  posting_number: string;
  etgb: { number: string; date: string; url: string };
}

// Salt-okunur — ETGB (Türk gümrük beyannamesi) Ozon/kargo firması (ASE&GBS) tarafından kargo
// süreci içinde otomatik oluşturuluyor, biz burada sadece siparişe bağlı olanı gösteriyoruz.
export function EtgbInfo({ postingNumber }: { postingNumber: string }) {
  const [loading, setLoading] = useState(true);
  const [etgb, setEtgb] = useState<EtgbData | null>(null);

  useEffect(() => {
    fetch(`/api/orders/${encodeURIComponent(postingNumber)}/etgb`)
      .then((r) => r.json())
      .then((data) => setEtgb(data.etgb))
      .finally(() => setLoading(false));
  }, [postingNumber]);

  if (loading) return <div className="hint">ETGB kontrol ediliyor...</div>;
  if (!etgb) {
    return (
      <div className="hint">
        Henüz ETGB oluşmamış — kargo süreci tamamlanınca Ozon/ASE&GBS tarafından otomatik oluşturulur.
      </div>
    );
  }

  return (
    <div>
      <a href={etgb.etgb.url} target="_blank" rel="noreferrer">
        ETGB {etgb.etgb.number} — {new Date(etgb.etgb.date).toLocaleDateString("tr-TR")}
      </a>
    </div>
  );
}
