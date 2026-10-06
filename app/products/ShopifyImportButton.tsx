"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type JobStatus =
  | { state: "idle" }
  | { state: "running"; startedAt: string }
  | { state: "done"; startedAt: string; finishedAt: string; handles: number; variants: number }
  | { state: "error"; startedAt: string; finishedAt: string; message: string };

export function ShopifyImportButton() {
  const router = useRouter();
  const [status, setStatus] = useState<JobStatus>({ state: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/products/shopify-import")
      .then((res) => res.json())
      .then((data: JobStatus) => {
        setStatus(data);
        if (data.state === "running") startPolling();
      })
      .catch(() => {});
    return () => stopPolling();
  }, []);

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/products/shopify-import");
      const data = (await res.json()) as JobStatus;
      setStatus(data);
      if (data.state !== "running") {
        stopPolling();
        if (data.state === "done") router.refresh();
      }
    }, 5000);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function handleStart() {
    const res = await fetch("/api/products/shopify-import", { method: "POST" });
    const data = (await res.json()) as JobStatus;
    setStatus(data);
    if (res.status === 202) startPolling();
  }

  const running = status.state === "running";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button className="btn-secondary" disabled={running} onClick={handleStart}>
        {running ? "Shopify'dan içe aktarılıyor... (8-10dk)" : "Shopify'dan İçe Aktar"}
      </button>
      {status.state === "done" && (
        <div className="hint">
          Son çalıştırma: {status.handles} ürün / {status.variants} varyant güncellendi ({new Date(status.finishedAt).toLocaleString("tr-TR")})
        </div>
      )}
      {status.state === "error" && (
        <div className="hint" style={{ color: "var(--danger)" }}>
          Hata: {status.message}
        </div>
      )}
    </div>
  );
}
