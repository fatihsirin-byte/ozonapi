"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LabelDownloadButton } from "./LabelDownloadButton";

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
      // BİLEREK data.postingNumbers DEĞİL data.syncedPostings kullanılıyor — postingNumbers,
      // Ozon'un ham ship cevabının (hiç canlıda doğrulanmamış) ayrıştırılmasından geliyor ve boş
      // çıkabilir; syncedPostings ise shipOrder'ın GERÇEKTEN senkronize ettiği (en azından orijinal
      // posting'i içeren) liste — hep en az bir posting içerir (2026-09-11'de code review'da tespit
      // edildi: boş dizi gelirse kullanıcı hiç etiket indirme butonu göremiyordu).
      setResult(data.syncedPostings?.length > 0 ? data.syncedPostings : [postingNumber]);
      setStep("idle");
      // BİLEREK router.refresh() ÇAĞIRMIYORUZ — çağırırsak order.status artık "awaiting_packaging"
      // olmadığından bu bileşen anında kaldırılıp aşağıdaki etiket indirme butonları kullanıcı
      // henüz tıklayamadan kaybolurdu (2026-09-10/11'de code review + kullanıcı talebi: "barkodlarını
      // o ekrana çeksek"). Kullanıcı "Tamam" deyince (aşağıda) elle yeniliyoruz.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
        <div style={{ color: "var(--success)", fontWeight: 500 }}>
          Paketlendi{result.length > 1 ? ` — ${result.length} kutuya bölündü` : ""}
        </div>
        {/* Yeni posting'ler (bölünmüşse HER BİRİ) hemen senkronize edildi (bkz. shipOrder) — kargo
            etiketini indirmek/yazdırmak için sayfayı değiştirmeye gerek yok, buradan yapılabilir. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {result.map((pn) => (
            <div key={pn} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="hint" style={{ minWidth: 140 }}>{pn}</span>
              <LabelDownloadButton postingNumber={pn} />
            </div>
          ))}
        </div>
        <button type="button" className="btn-secondary" onClick={() => router.refresh()}>
          Tamam, sayfayı yenile
        </button>
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
