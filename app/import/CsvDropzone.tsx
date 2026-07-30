"use client";

import { useRef, useState } from "react";

export function CsvDropzone({ onImported }: { onImported(): void }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setMessage({ type: "error", text: "Sadece .csv dosyası kabul edilir" });
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/import/shopify-csv", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "İçe aktarma başarısız" });
        return;
      }
      setMessage({
        type: "success",
        text: `${data.handles} ürün, ${data.variants} varyant içe aktarıldı.`,
      });
      onImported();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Bilinmeyen hata" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8,
          padding: 32,
          textAlign: "center",
          cursor: "pointer",
          color: "var(--muted)",
        }}
      >
        {uploading ? "İşleniyor... (büyük CSV'ler birkaç dakika sürebilir)" : "Shopify ürün CSV'sini buraya sürükleyin ya da tıklayıp seçin"}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) upload(e.target.files[0]);
            e.target.value = "";
          }}
        />
      </div>
      {message && (
        <div className={`status-banner ${message.type === "success" ? "imported" : "failed"}`} style={{ marginTop: 16 }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
