"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CsvDropzone } from "./CsvDropzone";

interface HandleItem {
  handle: string;
  title: string;
  vendor: string | null;
  type: string | null;
  variantCount: number;
  submittedCount: number;
  sampleImage: string | null;
}

interface FacetOption {
  value: string;
  count: number;
}

const PAGE_SIZE = 25;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function StagingList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Filtre/sayfa durumu URL'e yazılıyor ki bir ürüne girip geri dönünce (tarayıcı geri
  // tuşu) kaldığınız filtre/sayfada kalasınız — önceden bu state sadece component
  // içindeydi, geri dönünce sayfa 1'e ve varsayılan filtrelere sıfırlanıyordu.
  const [page, setPage] = useState(() => Number(searchParams.get("page")) || 1);
  const [items, setItems] = useState<HandleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [settingStock, setSettingStock] = useState(false);
  const [stockResult, setStockResult] = useState<string | null>(null);

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [vendor, setVendor] = useState(() => searchParams.get("vendor") ?? "");
  const [type, setType] = useState(() => searchParams.get("type") ?? "");
  const [status, setStatus] = useState<"" | "draft" | "submitted">(
    () => (searchParams.get("status") as "" | "draft" | "submitted") ?? "draft",
  );
  const [vendors, setVendors] = useState<FacetOption[]>([]);
  const [types, setTypes] = useState<FacetOption[]>([]);

  const refreshFacets = useCallback((q: string, v: string, t: string, s: string) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (v) params.set("vendor", v);
    if (t) params.set("type", t);
    if (s) params.set("status", s);
    fetch(`/api/import/products/facets?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setVendors(data.vendors ?? []);
        setTypes(data.types ?? []);
      });
  }, []);

  const load = useCallback(async (targetPage: number, q: string, v: string, t: string, s: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
    if (q.trim()) params.set("q", q.trim());
    if (v) params.set("vendor", v);
    if (t) params.set("type", t);
    if (s) params.set("status", s);
    const res = await fetch(`/api/import/products?${params.toString()}`);
    const data = await res.json();
    setItems(data.items ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, []);

  // Filtreler değiştiğinde: hem liste hem de facet'ler (cascading — diğer filtrelerle
  // eşleşen vendor/type seçenekleri) yeniden çekilir. İlk render'da (URL'den gelen
  // sayfayı sıfırlamamak için) page'i 1'e zorlamıyoruz — sadece kullanıcı gerçekten bir
  // filtreyi DEĞİŞTİRDİĞİNDE sayfa 1'e dönüyor.
  const skipFilterResetRef = useRef(true);
  useEffect(() => {
    if (skipFilterResetRef.current) {
      skipFilterResetRef.current = false;
      load(page, debouncedSearch, vendor, type, status);
      refreshFacets(debouncedSearch, vendor, type, status);
      return;
    }
    setPage(1);
    load(1, debouncedSearch, vendor, type, status);
    refreshFacets(debouncedSearch, vendor, type, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, vendor, type, status]);

  useEffect(() => {
    if (page === 1) return;
    load(page, debouncedSearch, vendor, type, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Mevcut filtre/sayfa durumunu URL'e yazar — tarayıcı geri tuşuyla dönüldüğünde
  // (Next.js bu URL'i history'den okuyup component'i bu state'le yeniden mount ediyor)
  // kaldığınız yerde kalınsın diye.
  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    if (vendor) params.set("vendor", vendor);
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, vendor, type, status]);

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
      await load(page, debouncedSearch, vendor, type, status);
      refreshFacets(debouncedSearch, vendor, type, status);
    } finally {
      setDeleting(false);
    }
  }

  async function setAllStock() {
    if (!confirm("Ozon'a bağlı TÜM ürünlerin stoğu 100 olarak gönderilecek. Devam edilsin mi?")) return;
    setSettingStock(true);
    setStockResult(null);
    try {
      const res = await fetch("/api/products/set-all-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock: 100 }),
      });
      const data = await res.json();
      setStockResult(`${data.updated}/${data.total} ürünün stoğu güncellendi.`);
    } finally {
      setSettingStock(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <CsvDropzone
        onImported={() => {
          load(1, debouncedSearch, vendor, type, status);
          refreshFacets(debouncedSearch, vendor, type, status);
        }}
      />

      <div className="card">
        <div className="filter-bar">
          <input
            type="text"
            placeholder="Ürün adı veya handle ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">Tüm tedarikçiler (Vendor)</option>
            {vendors.map((v) => (
              <option key={v.value} value={v.value}>
                {v.value} ({v.count})
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Tüm tipler (Type)</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.value} ({t.count})
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as "" | "draft" | "submitted")}>
            <option value="">Tüm durumlar</option>
            <option value="draft">Henüz gönderilmedi (draft)</option>
            <option value="submitted">Ozon'a gönderildi</option>
          </select>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <strong>{total}</strong> ürün bekliyor (henüz Ozon'a gönderilmedi)
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {stockResult && <span className="hint">{stockResult}</span>}
            <button type="button" className="btn-secondary" disabled={settingStock} onClick={setAllStock}>
              {settingStock ? "Gönderiliyor..." : "Ozon'a Bağlı Tüm Ürünlerin Stoğunu 100 Yap"}
            </button>
            {selected.size > 0 && (
              <button type="button" className="btn-secondary" disabled={deleting} onClick={bulkDelete}>
                {deleting ? "Siliniyor..." : `Seçilenleri Sil (${selected.size})`}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="hint">Yükleniyor...</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            {search || vendor || type || status
              ? "Bu filtreyle eşleşen ürün yok."
              : "İçe aktarılmış ürün yok. Yukarıdan bir Shopify CSV'si yükleyin."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={selected.size === items.length} onChange={toggleAll} />
                </th>
                <th>Görsel</th>
                <th>Ürün</th>
                <th>Vendor</th>
                <th>Type</th>
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
                        className="zoom-thumb"
                        style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }}
                      />
                    ) : (
                      <div style={{ width: 56, height: 56, borderRadius: 6, background: "#1a1e24" }} />
                    )}
                  </td>
                  <td>
                    <Link href={`/import/${encodeURIComponent(item.handle)}`}>{item.title}</Link>
                    <div className="hint" style={{ margin: 0 }}>
                      {item.handle}
                    </div>
                  </td>
                  <td>{item.vendor ?? <span className="hint">—</span>}</td>
                  <td>{item.type ?? <span className="hint">—</span>}</td>
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
