"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Ozon panelinde "Topla" dendiğinde kutuya bölme seçeneği SADECE paketteki toplam ürün adedi
// 1'den fazlaysa çıkıyor (kullanıcı notu, bkz. BEKLEYEN-GELISTIRMELER.md #3) — burada da aynı
// davranış taklit ediliyor.
export function ShipOrderButton({
  postingNumber,
  totalQuantity,
  locked,
}: {
  postingNumber: string;
  totalQuantity: number;
  // Önceki bir "Topla" denemesi belirsiz kaldıysa (bkz. shipOrder'daki shipClaimedAt kilidi) bu
  // sipariş kilitli kalmış demektir — butonu göstermek yerine ne yapılması gerektiğini
  // açıklıyoruz, aksi halde kullanıcı tekrar tıklayıp hep aynı hatayı alır (2026-09-10'da code
  // review'da tespit edildi).
  locked?: boolean;
}) {
  const router = useRouter();
  const canSplit = totalQuantity > 1;
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [multiBoxQty, setMultiBoxQty] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string[] | null>(null);

  async function ship() {
    setError(null);
    // Sayı olmayan/geçersiz bir kutu sayısı GİRİLDİYSE sessizce bölmesiz devam etmek yerine
    // durduruyoruz — aksi halde kullanıcı bölme istediğini sanırken sipariş tek kutu olarak
    // paketlenebilirdi (2026-09-10'da code review'da tespit edildi).
    let qty: number | undefined;
    if (canSplit) {
      const parsed = Number(multiBoxQty);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setError("Geçerli bir kutu sayısı girin (1 ya da daha büyük bir tam sayı).");
        return;
      }
      qty = parsed;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ multiBoxQty: qty }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Paketlenemedi");
        return;
      }
      setResult(data.postingNumbers ?? []);
      setStep("idle");
      // router.refresh() sayfayı hemen yeniden çizdiriyor — order.status artık "awaiting_packaging"
      // olmadığından bu bileşen anında kaldırılıp "Paketlendi" mesajı hiç görünmeden kayboluyordu
      // (2026-09-10'da code review'da tespit edildi). Kullanıcı mesajı görsün diye kısa bir
      // gecikme bırakılıyor.
      setTimeout(() => router.refresh(), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="hint" style={{ color: "var(--success)" }}>
        Paketlendi{result.length > 1 ? ` — ${result.length} kutuya bölündü (${result.join(", ")})` : ""}
      </div>
    );
  }

  if (locked) {
    return (
      <div className="hint" style={{ color: "var(--danger)", maxWidth: 280 }}>
        Bu sipariş için önceki bir "Topla" denemesi belirsiz kaldı — Ozon panelinden GERÇEKTEN
        paketlenip paketlenmediğini kontrol edin, ardından gerekirse{" "}
        <code>clear-stuck-ship-claim.ts</code> script'iyle kilidi temizleyin.
      </div>
    );
  }

  if (step === "idle") {
    return (
      <div>
        <button type="button" className="btn-secondary" onClick={() => setStep("confirm")}>
          Topla
        </button>
        {error && <div className="hint" style={{ color: "var(--danger)", marginTop: 6 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
      <div style={{ fontWeight: 500 }}>Bu siparişi paketle ve Ozon'a bildir</div>
      <div className="hint">Bu işlem Ozon'a GERÇEK bir sevkiyat onayı gönderir, geri alınamaz.</div>
      {canSplit && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          Kaç kutuya bölünsün? (1 = bölme, tek kutu)
          <input
            type="number"
            min="1"
            value={multiBoxQty}
            onChange={(e) => setMultiBoxQty(e.target.value)}
            style={{ width: 80 }}
          />
        </label>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn-primary" disabled={loading} onClick={ship}>
          {loading ? "Paketleniyor..." : "Evet, Paketle"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={loading}
          onClick={() => {
            setStep("idle");
            setError(null);
          }}
        >
          Vazgeç
        </button>
      </div>
      {error && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
    </div>
  );
}
