"use client";

import { useEffect, useRef, useState } from "react";

interface OrderItemLite {
  offerId: string;
  name: string;
}

interface InvoiceResult {
  date: string;
  file_url: string;
  hs_codes: Array<{ code: string; sku: string }>;
  number: string;
  price: number;
  price_currency: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data:application/pdf;base64,XXXX -> sadece XXXX kısmı Ozon'un beklediği format
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function OzonInvoicePanel({
  postingNumber,
  items,
  defaultPrice,
  suggestedInvoiceAmount,
}: {
  postingNumber: string;
  items: OrderItemLite[];
  defaultPrice: number;
  suggestedInvoiceAmount?: number | null;
}) {
  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState<InvoiceResult | null>(null);
  const [hsCodes, setHsCodes] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Seçilen PDF'i Ozon'a göndermeden önce yeni sekmede açıp (tarih vb.) kontrol edebilmek için —
  // her yeni dosya seçiminde eski object URL serbest bırakılır (bellek sızıntısı olmasın diye).
  function selectFile(next: File) {
    setFile(next);
    setFilePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(next);
    });
  }

  useEffect(() => {
    return () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState(String(defaultPrice.toFixed(2)));
  const [currency, setCurrency] = useState("USD");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/orders/${encodeURIComponent(postingNumber)}/invoice`)
      .then((r) => r.json())
      .then((data) => {
        setInvoice(data.invoice);
        setHsCodes(data.suggestedHsCodes ?? {});
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postingNumber]);

  async function submit() {
    if (!file) {
      setError("Önce bir PDF seçin/sürükleyin");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64,
          number,
          date: new Date(date).toISOString(),
          price: Number(price) || 0,
          priceCurrency: currency,
          hsCodes: items.map((item) => ({ code: hsCodes[item.offerId] ?? "", sku: item.offerId })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Fatura gönderilemedi");
        return;
      }
      const refreshed = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/invoice`).then((r) => r.json());
      setInvoice(refreshed.invoice);
      setFile(null);
      setFilePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    setSubmitting(true);
    try {
      await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/invoice`, { method: "DELETE" });
      setInvoice(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="hint">Fatura durumu kontrol ediliyor...</div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div className="hint">Fatura Kesilecek Tutar (alış × %40 marj)</div>
        <div className="value" style={{ fontSize: 15 }}>
          {suggestedInvoiceAmount == null ? (
            <span className="hint">alış maliyeti bilinmiyor</span>
          ) : (
            `$${suggestedInvoiceAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          )}
        </div>
      </div>

      {invoice ? (
        <div style={{ marginBottom: 16 }}>
          <div className="hint">Yüklenmiş fatura</div>
          <div>
            <a href={invoice.file_url} target="_blank" rel="noreferrer">
              {invoice.number} — {new Date(invoice.date).toLocaleDateString("tr-TR")} — {invoice.price} {invoice.price_currency}
            </a>
          </div>
          <button type="button" className="btn-secondary" style={{ marginTop: 8 }} disabled={submitting} onClick={remove}>
            Faturayı Kaldır
          </button>
        </div>
      ) : (
        <div className="hint" style={{ marginBottom: 12 }}>Bu siparişe henüz Ozon'a yüklenmiş bir fatura yok.</div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8,
          padding: 20,
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])}
        />
        {file ? (
          <a
            href={filePreviewUrl ?? undefined}
            target="_blank"
            // NOT: rel="noreferrer"/"noopener" burada BİLEREK yok — blob: URL'ler yeni sekmeye
            // opener bağlantısı olmadan (noopener ile) taşınamıyor, sekme boş açılıyor (2026-08-10'da
            // canlıda tespit edildi). Bu link zaten aynı origin'e (kendi blob'umuza) gittiği için
            // noopener'ın engellemeye çalıştığı güvenlik riski yok.
            onClick={(e) => e.stopPropagation()}
            title="Yeni sekmede aç (göndermeden önce kontrol et)"
          >
            {file.name}
          </a>
        ) : (
          <span className="hint">PDF faturayı buraya sürükle ya da tıkla</span>
        )}
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Fatura No</label>
          <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Tarih</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Tutar</label>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Para Birimi</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD</option>
            <option value="RUB">RUB</option>
          </select>
        </div>
      </div>

      <div className="hint" style={{ marginBottom: 6 }}>GTİP Kodu (kalem başına — üründen otomatik önerilir, gerekirse düzeltebilirsin)</div>
      {items.map((item) => (
        <div key={item.offerId} className="row" style={{ marginBottom: 6, alignItems: "center" }}>
          <div style={{ flex: 1, fontSize: 13 }}>{item.offerId} — {item.name}</div>
          <input
            type="text"
            style={{ width: 160 }}
            placeholder="GTİP kodu"
            value={hsCodes[item.offerId] ?? ""}
            onChange={(e) => setHsCodes((prev) => ({ ...prev, [item.offerId]: e.target.value }))}
          />
        </div>
      ))}

      {error && <div className="hint" style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div>}

      <button className="btn-primary" style={{ marginTop: 12 }} disabled={submitting || !file} onClick={submit}>
        {submitting ? "Gönderiliyor..." : "Ozon'a Fatura Yükle"}
      </button>
    </div>
  );
}
