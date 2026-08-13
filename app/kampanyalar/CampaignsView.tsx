"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface OzonAction {
  id: number;
  title: string;
  date_start: string;
  date_end: string;
  potential_products_count: number;
  participating_products_count: number;
  is_participating: boolean;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR");
}

export function CampaignsView() {
  const [actions, setActions] = useState<OzonAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/actions")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setActions(data.actions ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <div className="hint" style={{ marginBottom: 16 }}>
        Ozon'un kendi yürüttüğü indirim/promosyon aksiyonları — ücretli reklam kampanyası değil, ürünlerin bu
        aksiyonlara katılıp katılmadığını buradan yönetebilirsin.
      </div>

      {loading ? (
        <div className="hint">Yükleniyor...</div>
      ) : error ? (
        <div className="hint" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      ) : actions.length === 0 ? (
        <div className="empty-state">Şu an hesapta aktif bir aksiyon yok.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Aksiyon</th>
              <th>Tarih Aralığı</th>
              <th>Katılan Ürün</th>
              <th>Aday Ürün</th>
              <th>Durum</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td className="hint" style={{ margin: 0 }}>
                  {fmtDate(a.date_start)} — {fmtDate(a.date_end)}
                </td>
                <td>{a.participating_products_count}</td>
                <td>{a.potential_products_count}</td>
                <td>
                  {a.is_participating ? (
                    <span className="badge imported">Katılıyor</span>
                  ) : (
                    <span className="badge draft">Katılmıyor</span>
                  )}
                </td>
                <td>
                  <Link href={`/kampanyalar/${a.id}`}>
                    <button type="button" className="btn-secondary">
                      Ürünleri Gör
                    </button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
