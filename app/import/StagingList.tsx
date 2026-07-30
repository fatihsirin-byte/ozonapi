"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CsvDropzone } from "./CsvDropzone";

interface HandleItem {
  handle: string;
  title: string;
  variantCount: number;
  submittedCount: number;
  sampleImage: string | null;
}

const PAGE_SIZE = 25;

export function StagingList() {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HandleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (targetPage: number) => {
    setLoading(true);
    const res = await fetch(`/api/import/products?page=${targetPage}&pageSize=${PAGE_SIZE}`);
    const data = await res.json();
    setItems(data.items ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  function toggle(handle: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.handle))));
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size} ürünü (tüm varyantlarıyla) silmek istediğinize emin misiniz?`)) return;
    setDeleting(true);
    try {
      await fetch("/api/import/products/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handles: Array.from(selected) }),
      });
      setSelected(new Set());
      await load(page);
    } finally {
      setDeleting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <CsvDropzone onImported={() => load(1)} />

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <strong>{total}</strong> ürün bekliyor (henüz Ozon'a gönderilmedi)
          </div>
          {selected.size > 0 && (
            <button type="button" className="btn-secondary" disabled={deleting} onClick={bulkDelete}>
              {deleting ? "Siliniyor..." : `Seçilenleri Sil (${selected.size})`}
            </button>
          )}
        </div>

        {loading ? (
          <div className="hint">Yükleniyor...</div>
        ) : items.length === 0 ? (
          <div className="empty-state">İçe aktarılmış ürün yok. Yukarıdan bir Shopify CSV'si yükleyin.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={selected.size === items.length} onChange={toggleAll} />
                </th>
                <th>Görsel</th>
                <th>Ürün</th>
                <th>Varyant</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.handle}>
                  <td>
                    <input type="checkbox" checked={selected.has(item.handle)} onChange={() => toggle(item.handle)} />
                  </td>
                  <td>
                    {item.sampleImage ? (
                      <img
                        src={item.sampleImage}
                        alt=""
                        style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }}
                      />
                    ) : (
                      <div style={{ width: 48, height: 48, borderRadius: 6, background: "#1a1e24" }} />
                    )}
                  </td>
                  <td>
                    <Link href={`/import/${encodeURIComponent(item.handle)}`}>{item.title}</Link>
                    <div className="hint" style={{ margin: 0 }}>
                      {item.handle}
                    </div>
                  </td>
                  <td>{item.variantCount}</td>
                  <td>
                    {item.submittedCount > 0 ? (
                      <span className="badge pending">
                        {item.submittedCount}/{item.variantCount} gönderildi
                      </span>
                    ) : (
                      <span className="badge draft">draft</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
            <button className="btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ← Önceki
            </button>
            <span className="hint" style={{ alignSelf: "center" }}>
              Sayfa {page} / {totalPages}
            </span>
            <button className="btn-secondary" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
              Sonraki →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
