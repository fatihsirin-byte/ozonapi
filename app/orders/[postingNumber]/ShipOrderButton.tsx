"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LabelDownloadButton } from "./LabelDownloadButton";
import { WEIGHT_WARNING_TEXT } from "../weightWarningText";
import { shipPosting } from "../shipPosting";

// Ozon panelinde "Topla" dendiğinde kutuya bölme seçeneği SADECE paketteki toplam ürün adedi
// 1'den fazlaysa çıkıyor (kullanıcı notu, bkz. BEKLEYEN-GELISTIRMELER.md #3) — burada da aynı
// davranış taklit ediliyor.
export function ShipOrderButton({
  postingNumber,
  totalQuantity,
  locked,
  weightWarning,
}: {
  postingNumber: string;
  totalQuantity: number;
  // Önceki bir "Topla" denemesi belirsiz kaldıysa (bkz. shipOrder'daki shipClaimedAt kilidi) bu
  // sipariş kilitli kalmış demektir — butonu göstermek yerine ne yapılması gerektiğini
  // açıklıyoruz, aksi halde kullanıcı tekrar tıklayıp hep aynı hatayı alır (2026-09-10'da code
  // review'da tespit edildi).
  locked?: boolean;
  // Sipariş "500g altı" lojistik deposundan geldi ve birden fazla FARKLI ürün içeriyor — tek kutuda
  // paketlenirse toplam ağırlık 500g'ı geçip teslimat sorununa yol açabilir (bkz.
  // orders.service.ts getWeightSplitWarning, 2026-09-11 kullanıcı talebi).
  weightWarning?: boolean;
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
      // Toplam adetten fazla kutuya bölünemez — server da aynı kontrolü yapıyor, burada erken
      // durdurmak gereksiz bir istek atmayı önlüyor (2026-09-11'de gerçek bir denemede, packages
      // dizisine dağıtım eklenince bu sınır anlamlı hale geldi).
      if (parsed > totalQuantity) {
        setError(`Bu siparişte toplam ${totalQuantity} adet var — en fazla ${totalQuantity} kutuya bölünebilir.`);
        return;
      }
      qty = parsed;
    }
    setLoading(true);
    const res = await shipPosting(postingNumber, qty);
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? "Paketlenemedi");
      return;
    }
    setResult(res.syncedPostings ?? [postingNumber]);
    setStep("idle");
    // BİLEREK router.refresh() ÇAĞIRMIYORUZ — çağırırsak order.status artık "awaiting_packaging"
    // olmadığından bu bileşen anında kaldırılıp aşağıdaki etiket indirme butonları kullanıcı
    // henüz tıklayamadan kaybolurdu (2026-09-10/11'de code review + kullanıcı talebi: "barkodlarını
    // o ekrana çeksek"). Kullanıcı "Tamam" deyince (aşağıda) elle yeniliyoruz.
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
      {weightWarning && (
        <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 500 }}>{WEIGHT_WARNING_TEXT}</div>
      )}
      {canSplit && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          Kaç kutuya bölünsün? (1 = bölme, tek kutu, en fazla {totalQuantity})
          <input
            type="number"
            min="1"
            max={totalQuantity}
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
