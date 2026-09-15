"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isHsCodeError } from "@/ase/constants";

interface Props {
  postingNumber: string;
  // Fatura numarası kesinleşmeden (bkz. Order.parasutInvoiceNoConfirmed) ASE'ye gönderimin bir
  // anlamı yok — sendOrderToAse zaten sessizce hiçbir şey yapmıyor, ama butonu da o zamana kadar
  // devre dışı bırakıp kullanıcının "tıkladım, hiçbir şey olmadı" izlenimine kapılmasını önlüyoruz.
  invoiceConfirmed: boolean;
  initialSentAt: string | null;
  initialSuccess: boolean | null;
  initialMessage: string | null;
}

interface OrderHsCodeInfo {
  offerId: string;
  productName: string;
  hsCode: string | null;
}

interface AseShipmentResponse {
  sentAt: string | null;
  success: boolean | null;
  message: string | null;
  errorCode: string | null;
  items: OrderHsCodeInfo[];
}

// ASE'ye (gümrük/ETGB) bildirim — SADECE bu butonla, elle gönderilir (2026-09-13, kullanıcı talebi:
// önceki sürüm hem fatura PDF durumu her kontrol edildiğinde hem 15 dakikalık senkronizasyon
// cron'unda kendiliğinden "fatura numarası kesinleşmiş ama gönderilmemiş" siparişleri bulup
// gönderiyordu — kullanıcı bunu öngörülemez buldu, "fatura kestikten sonra buton gelsin" istedi).
// Hem Siparişler listesinde hem sipariş detay sayfasında kullanılıyor (2026-09-15, kullanıcı
// talebi: "buton sadece siparişin içinde var, listede de olması gerekiyor") — bu yüzden
// ParasutInvoiceButton ile aynı paylaşılan konumda (app/orders/) duruyor.
//
// HS KOD HATASI AKIŞI (2026-09-13, kullanıcı talebi: "hs kod hata veriyorsa retry yapmayı,
// başarılı olanı ürüne sonsuza kadar kaydetmeyi sağla"): gönderim özellikle HS kodu yüzünden
// başarısız olursa (bkz. src/ase/constants.ts isHsCodeError — SADECE errorCode "34"e değil, hata
// METNİNE de bakıyor; ASE aynı sorunu "31" gibi başka kodlarla da döndürebiliyor, 2026-09-15'te
// canlıda tespit edildi), her kalem için düzenlenebilir bir HS kod alanı içeren bir
// popup açılır. "Kaydet ve Tekrar Dene"ye basınca önce her kalemin HS kodu Product.gtipOverride
// olarak KALICI kaydedilir (bkz. PATCH /api/products/[offerId]) — bu, sonraki tüm siparişlerde de
// otomatik kullanılacağı için "başarılı olanı ürüne sonsuza kadar kaydet" isteğini karşılıyor,
// ayrıca ürün sayfasından istenirse elle değiştirilebilir — sonra ASE'ye TEKRAR gönderilir. Yine
// aynı hatayı alırsa popup açık kalıp yeni hatayı gösterir, kullanıcı düzeltip tekrar dener; bu
// döngü BAŞARILI olana ya da kullanıcı popup'ı kapatana kadar sürer.
export function AseShipmentButton({ postingNumber, invoiceConfirmed, initialSentAt, initialSuccess, initialMessage }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sentAt, setSentAt] = useState(initialSentAt);
  const [success, setSuccess] = useState(initialSuccess);
  const [message, setMessage] = useState(initialMessage);

  const [hsPopupOpen, setHsPopupOpen] = useState(false);
  const [hsInputs, setHsInputs] = useState<Record<string, string>>({});
  const [hsProductNames, setHsProductNames] = useState<Record<string, string>>({});
  const [hsSaving, setHsSaving] = useState(false);
  const [hsPopupError, setHsPopupError] = useState<string | null>(null);

  async function send(): Promise<AseShipmentResponse | null> {
    const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/ase-shipment`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setSuccess(false);
      setMessage(data.error ?? "Gönderilemedi");
      setSentAt(new Date().toISOString());
      return null;
    }
    return data as AseShipmentResponse;
  }

  async function handleSend() {
    setLoading(true);
    try {
      const data = await send();
      if (!data) return;
      setSentAt(data.sentAt);
      setSuccess(data.success);
      setMessage(data.message);
      // Sayfadaki EtgbInfo bileşeni ASE durumunu kendi fetch'i yerine sunucudan (page.tsx) PROP
      // olarak alıyor — sonuç ne olursa olsun (başarılı ya da başarısız) router.refresh() ile
      // sunucu bileşenini tazeleyip EtgbInfo'nun da güncel durumu görmesini sağlıyoruz, aksi
      // halde iki bileşen sayfa yenilenene kadar farklı şey gösterirdi (2026-09-13 code review'da
      // SADECE başarı durumunda çağrıldığı, başarısız gönderimlerde bu tutarsızlığı yeniden
      // yarattığı tespit edildi).
      router.refresh();
      if (data.success) {
        setHsPopupOpen(false);
      } else if (isHsCodeError(data.errorCode, data.message)) {
        const inputs: Record<string, string> = {};
        const names: Record<string, string> = {};
        for (const item of data.items) {
          inputs[item.offerId] = item.hsCode ?? "";
          names[item.offerId] = item.productName;
        }
        setHsInputs(inputs);
        setHsProductNames(names);
        setHsPopupError(data.message);
        setHsPopupOpen(true);
      }
    } catch (err) {
      setSuccess(false);
      setMessage(err instanceof Error ? err.message : "Bilinmeyen hata");
      setSentAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }

  async function handleHsRetry() {
    setHsSaving(true);
    setHsPopupError(null);
    try {
      // Önce her kalemin HS kodunu ÜRÜNE kalıcı olarak kaydet (Product.gtipOverride) — böylece
      // bir sonraki siparişte de otomatik kullanılır, gerekirse ürün sayfasından elle değiştirilebilir.
      await Promise.all(
        Object.entries(hsInputs).map(([offerId, hsCode]) =>
          fetch(`/api/products/${encodeURIComponent(offerId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gtipOverride: hsCode.trim() || null }),
          }),
        ),
      );

      const data = await send();
      if (!data) return;
      setSentAt(data.sentAt);
      setSuccess(data.success);
      setMessage(data.message);
      router.refresh();
      if (data.success) {
        setHsPopupOpen(false);
      } else if (isHsCodeError(data.errorCode, data.message)) {
        // Hâlâ hatalı — popup açık kalır, kullanıcının az önce girdiği değerler korunur (üzerine
        // yazılmaz), sadece yeni hata mesajı gösterilir.
        setHsPopupError(data.message);
      } else {
        // HS kodu artık sorun değil ama başka bir hata çıktı (ör. fatura/dosya sorunu) — popup'ın
        // burada bir işlevi kalmadı, kapatıp normal hata gösterimine dönülüyor.
        setHsPopupOpen(false);
      }
    } catch (err) {
      setHsPopupError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setHsSaving(false);
    }
  }

  if (!invoiceConfirmed) {
    return (
      <button className="btn-secondary" disabled title="Fatura numarası kesinleşmeden ASE'ye gönderilemez">
        ASE'ye Gönder
      </button>
    );
  }

  // Zaten başarıyla gönderildiyse buton tekrar aktif gösterilmiyor — sendOrderToAse tekrar
  // tıklansa bile ikinci gönderime izin vermiyor (bkz. src/ase/orderShipment.ts), bu yüzden
  // kullanıcıya doğrudan sonucu gösteriyoruz.
  if (success) {
    return (
      <span className="hint" style={{ color: "var(--success)" }}>
        ASE&apos;ye gönderildi ✓{sentAt ? ` (${new Date(sentAt).toLocaleString("tr-TR")})` : ""}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button className="btn-secondary" disabled={loading} onClick={handleSend}>
        {loading ? "Gönderiliyor..." : "ASE'ye Gönder"}
      </button>
      {success === false && (
        <span className="hint" style={{ color: "var(--danger)" }}>
          {message ?? "Gönderim başarısız"}
        </span>
      )}

      {hsPopupOpen && (
        <div className="modal-overlay" onClick={() => setHsPopupOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>HS (GTİP) kodu düzeltilmeli</h3>
            <p className="hint">
              {hsPopupError ?? "HS kodu boş ya da hatalı."} Lütfen aşağıdaki ürünler için doğru GTİP kodunu girip
              tekrar deneyin.
            </p>
            {Object.keys(hsInputs).map((offerId) => (
              <div key={offerId} className="field">
                <label>{hsProductNames[offerId] ?? offerId}</label>
                <input
                  type="text"
                  value={hsInputs[offerId]}
                  onChange={(e) => setHsInputs((prev) => ({ ...prev, [offerId]: e.target.value }))}
                  placeholder="Örn. 330499009000"
                />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className="btn-secondary" onClick={() => setHsPopupOpen(false)} disabled={hsSaving}>
                Kapat
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleHsRetry}
                disabled={hsSaving || Object.values(hsInputs).some((v) => !v.trim())}
              >
                {hsSaving ? "Kaydediliyor ve deneniyor..." : "Kaydet ve Tekrar Dene"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
