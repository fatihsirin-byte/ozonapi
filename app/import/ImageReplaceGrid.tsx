"use client";

import { useRef, useState } from "react";

interface Props {
  originalImages: string[];
  images: string[];
  onChange(images: string[]): void;
}

// Görsel değiştirme arayüzü: eski (Shopify) görseller büyük kartlarla gösterilir, her birinde
// "Kopyala" (URL) ve "Kullan/Kullanma" var. Altta yeni görsel için mevcut sürükle-bırak yükleme var.
// Amaç: eski görselleri Rusça bilgilendirici görsellerle değiştirirken referans/karşılaştırma kolay olsun.
export function ImageReplaceGrid({ originalImages, images, onChange }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl((current) => (current === url ? null : current)), 1500);
  }

  function isUsed(url: string) {
    return images.includes(url);
  }

  function toggleOriginal(url: string) {
    onChange(isUsed(url) ? images.filter((u) => u !== url) : [...images, url]);
  }

  function useAllOriginals() {
    onChange(Array.from(new Set([...images, ...originalImages])));
  }

  function removeImage(url: string) {
    onChange(images.filter((u) => u !== url));
  }

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true);
    setError(null);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Yükleme başarısız");
          continue;
        }
        uploaded.push(data.url);
      }
      onChange([...images, ...uploaded]);
    } finally {
      setUploading(false);
    }
  }

  const newImages = images.filter((url) => !originalImages.includes(url));

  return (
    <div>
      {originalImages.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ margin: 0 }}>Eski görseller (Shopify)</label>
            <button type="button" className="btn-secondary" onClick={useAllOriginals}>
              Tümünü kullan
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {originalImages.map((url) => (
              <div
                key={url}
                style={{
                  border: `2px solid ${isUsed(url) ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "#0f1216",
                }}
              >
                <img
                  src={url}
                  alt=""
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "contain",
                    background: "#fff",
                    display: "block",
                  }}
                />
                <div style={{ display: "flex", gap: 6, padding: 8 }}>
                  <button
                    type="button"
                    className={isUsed(url) ? "btn-primary" : "btn-secondary"}
                    style={{ flex: 1, fontSize: 12 }}
                    onClick={() => toggleOriginal(url)}
                  >
                    {isUsed(url) ? "Kullanılıyor ✓" : "Kullan"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: 12 }}
                    onClick={() => copyUrl(url)}
                    title="Görsel URL'ini kopyala"
                  >
                    {copiedUrl === url ? "Kopyalandı ✓" : "Kopyala"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <label>Yeni görseller (Rusça/bilgilendirici)</label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8,
          padding: 32,
          textAlign: "center",
          cursor: "pointer",
          color: "var(--muted)",
          fontSize: 13,
        }}
      >
        {uploading ? "Yükleniyor..." : "Yeni görselleri buraya sürükleyin ya da tıklayıp seçin (JPEG/PNG/WEBP)"}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}

      {newImages.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          {newImages.map((url) => (
            <div key={url} style={{ position: "relative", borderRadius: 10, overflow: "hidden" }}>
              <img src={url} alt="" style={{ width: "100%", height: 220, objectFit: "cover", display: "block" }} />
              <button
                type="button"
                onClick={() => removeImage(url)}
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "var(--danger)",
                  color: "white",
                  fontSize: 14,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="hint" style={{ marginTop: 12 }}>
        Gönderilecek görsel sayısı: {images.length}
      </div>
    </div>
  );
}
