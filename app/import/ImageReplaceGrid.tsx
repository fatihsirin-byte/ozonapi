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
  const [copyMode, setCopyMode] = useState<"image" | "url" | null>(null);
  const [orderDragIndex, setOrderDragIndex] = useState<number | null>(null);
  const [orderOverIndex, setOrderOverIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function moveImage(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const next = [...images];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  }

  // Çoğu tarayıcının pano API'si sadece image/png kabul ediyor — Shopify/upload görselleri
  // genelde jpg olduğu için canvas ile png'ye çevirip öyle kopyalıyoruz.
  async function toPngBlob(blob: Blob): Promise<Blob> {
    if (blob.type === "image/png") return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas context yok");
    ctx.drawImage(bitmap, 0, 0);
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob başarısız"))), "image/png");
    });
  }

  // Gerçek görseli panoya kopyalar (Canva/Photoshop gibi bir yere doğrudan yapıştırılabilsin diye).
  // CORS engeli (bazı CDN'ler) ya da tarayıcı desteklemiyorsa en azından URL'i kopyalar.
  async function copyUrl(url: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const pngBlob = await toPngBlob(blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setCopyMode("image");
    } catch {
      await navigator.clipboard.writeText(url);
      setCopyMode("url");
    }
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
                    title="Görseli panoya kopyala (yapıştıramazsanız URL kopyalanır)"
                  >
                    {copiedUrl === url
                      ? copyMode === "image"
                        ? "Görsel Kopyalandı ✓"
                        : "URL Kopyalandı ✓"
                      : "Kopyala"}
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

      {images.length > 0 && (
        <>
          <label style={{ marginTop: 20 }}>Gönderilecek görseller — sıra (Ozon'a bu sırayla gider, ilki kapak görseli)</label>
          <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>
            Sırayı değiştirmek için kartları sürükleyip bırakın.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {images.map((url, index) => (
              <div
                key={url}
                draggable
                onDragStart={() => setOrderDragIndex(index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOrderOverIndex(index);
                }}
                onDragLeave={() => setOrderOverIndex((current) => (current === index ? null : current))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (orderDragIndex !== null) moveImage(orderDragIndex, index);
                  setOrderDragIndex(null);
                  setOrderOverIndex(null);
                }}
                onDragEnd={() => {
                  setOrderDragIndex(null);
                  setOrderOverIndex(null);
                }}
                style={{
                  position: "relative",
                  width: 110,
                  cursor: "grab",
                  border: `2px solid ${orderOverIndex === index ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 8,
                  overflow: "hidden",
                  opacity: orderDragIndex === index ? 0.4 : 1,
                  background: "#fff",
                }}
              >
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "contain", display: "block" }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 4,
                    left: 4,
                    background: index === 0 ? "var(--accent)" : "rgba(0,0,0,0.65)",
                    color: "white",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 4,
                    padding: "1px 6px",
                  }}
                >
                  {index + 1}
                </div>
                <button
                  type="button"
                  onClick={() => removeImage(url)}
                  title="Bu görseli kaldır (eski/yeni fark etmeksizin)"
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "var(--danger)",
                    color: "white",
                    fontSize: 13,
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="hint" style={{ marginTop: 12 }}>
        Gönderilecek görsel sayısı: {images.length}
      </div>
    </div>
  );
}
