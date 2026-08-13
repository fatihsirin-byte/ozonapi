"use client";

import { useCallback, useEffect, useState } from "react";

interface OzonAction {
  id: number;
  title: string;
  date_start: string;
  date_end: string;
  potential_products_count: number;
  participating_products_count: number;
  is_participating: boolean;
}

interface ActionProduct {
  id: number;
  price: number;
  action_price: number;
  max_action_price: number;
  price_min_elastic?: number;
  price_max_elastic?: number;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR");
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CampaignsView() {
  const [actions, setActions] = useState<OzonAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<OzonAction | null>(null);

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
                  <button type="button" className="btn-secondary" onClick={() => setSelectedAction(a)}>
                    Ürünleri Gör
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedAction && <ActionDetail action={selectedAction} onClose={() => setSelectedAction(null)} />}
    </div>
  );
}

function ActionDetail({ action, onClose }: { action: OzonAction; onClose(): void }) {
  const [tab, setTab] = useState<"participating" | "candidates">("participating");
  const [products, setProducts] = useState<ActionProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [priceInputs, setPriceInputs] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/actions/${action.id}/products?type=${tab}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setProducts(data.products ?? []);
      })
      .finally(() => setLoading(false));
  }, [action.id, tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function activate(product: ActionProduct) {
    const actionPrice = Number(priceInputs[product.id]);
    if (!actionPrice) {
      alert("Önce bir aksiyon fiyatı gir");
      return;
    }
    if (
      !confirm(
        `Ürün ${product.id}, "${action.title}" aksiyonuna ${fmtUsd(actionPrice)} fiyatla eklenecek — bu Ozon'da GERÇEK, canlı bir değişiklik. Devam edilsin mi?`,
      )
    )
      return;
    setBusyId(product.id);
    try {
      const res = await fetch(`/api/actions/${action.id}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, actionPrice }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Eklenemedi");
        return;
      }
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function deactivate(product: ActionProduct) {
    if (!confirm(`Ürün ${product.id}, "${action.title}" aksiyonundan çıkarılacak. Devam edilsin mi?`)) return;
    setBusyId(product.id);
    try {
      await fetch(`/api/actions/${action.id}/products`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <strong style={{ fontSize: 18 }}>{action.title}</strong>
          <button type="button" className="btn-secondary" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="filter-bar">
          <button
            type="button"
            className={`btn-secondary${tab === "participating" ? " active" : ""}`}
            onClick={() => setTab("participating")}
          >
            Katılan Ürünler ({action.participating_products_count})
          </button>
          <button
            type="button"
            className={`btn-secondary${tab === "candidates" ? " active" : ""}`}
            onClick={() => setTab("candidates")}
          >
            Aday Ürünler ({action.potential_products_count})
          </button>
        </div>

        {loading ? (
          <div className="hint">Yükleniyor...</div>
        ) : error ? (
          <div className="hint" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        ) : products.length === 0 ? (
          <div className="empty-state">Bu listede ürün yok.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ozon Ürün ID</th>
                <th>Fiyat</th>
                {tab === "participating" ? <th>Aksiyon Fiyatı</th> : <th>İzin Verilen Aralık</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{fmtUsd(p.price)}</td>
                  {tab === "participating" ? (
                    <td>{fmtUsd(p.action_price)}</td>
                  ) : (
                    <td>
                      {p.price_min_elastic != null && p.price_max_elastic != null
                        ? `${fmtUsd(p.price_max_elastic)} — ${fmtUsd(p.price_min_elastic)}`
                        : <span className="hint">—</span>}
                      <input
                        type="number"
                        placeholder="Aksiyon fiyatı"
                        style={{ width: 110, marginLeft: 8 }}
                        value={priceInputs[p.id] ?? ""}
                        onChange={(e) => setPriceInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      />
                    </td>
                  )}
                  <td>
                    {tab === "participating" ? (
                      <button type="button" className="btn-secondary" disabled={busyId === p.id} onClick={() => deactivate(p)}>
                        {busyId === p.id ? "..." : "Çıkar"}
                      </button>
                    ) : (
                      <button type="button" className="btn-primary" disabled={busyId === p.id} onClick={() => activate(p)}>
                        {busyId === p.id ? "..." : "Ekle"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
