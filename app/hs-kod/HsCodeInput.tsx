"use client";

import { useRef, useState } from "react";

type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid";

// Gerçek GTİP/HS kodları 12 haneli sayıdır — kullanıcı talebi (2026-09-25): "ufak 12 sayı kontrolü
// ekler misin hs kod için". Boş bırakmak (HS kodunu temizlemek) HÂLÂ geçerli — sadece DOLU bir
// değer 12 haneden farklıysa reddediliyor, kaydetme isteği hiç ATILMIYOR (yanlış uzunlukta bir kod
// sessizce kaydedilip ASE'ye yanlış gitmesin diye).
function isValidHsCode(trimmed: string): boolean {
  return trimmed === "" || /^\d{12}$/.test(trimmed);
}

// Kullanıcı talebi (2026-09-25): "yapıştırınca kaydet tekrar girersek ya da içinde değiştirirsek
// update et" — yani SADECE ilk yapıştırmada değil, alan sonradan tekrar düzenlenirse (elle
// yazılırsa ya da üzerine başka bir kod yapıştırılırsa) de otomatik kaydedilmeli. Bunu tek bir
// kurala indirgiyoruz: kutudan çıkıldığında (blur) değer SON KAYDEDİLEN değerden farklıysa kaydet.
// Yapıştırma (onPaste) da AYRICA, "blur"u BEKLEMEDEN aynı anda tetikliyor (kullanıcı özellikle
// "yapıştırınca kaydet" dedi) — DOM henüz güncellenmediği için setTimeout(0) ile bir sonraki tick'e
// bırakılıyor (input.value paste event'i işlenene kadar eski değeri taşıyor).
export function HsCodeInput({ offerId, initialValue }: { offerId: string; initialValue: string | null }) {
  const [value, setValue] = useState(initialValue ?? "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const lastSavedRef = useRef(initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  async function save(nextValue: string) {
    const trimmed = nextValue.trim();
    if (trimmed === lastSavedRef.current.trim()) return;
    if (!isValidHsCode(trimmed)) {
      setStatus("invalid");
      return;
    }
    setStatus("saving");
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(offerId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gtipOverride: trimmed || null }),
      });
      if (!res.ok) throw new Error();
      lastSavedRef.current = trimmed;
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  function handlePaste() {
    // Paste event'i sırasında input.value HENÜZ güncellenmedi — bir sonraki tick'te (paste DOM'a
    // işlendikten sonra) inputRef üzerinden GÜNCEL değeri okuyup kaydediyoruz.
    setTimeout(() => {
      const current = inputRef.current?.value ?? "";
      setValue(current);
      void save(current);
    }, 0);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (status !== "idle") setStatus("idle");
        }}
        onPaste={handlePaste}
        onBlur={() => void save(value)}
        placeholder="HS kodu gir/yapıştır"
        style={{ width: 160 }}
      />
      {status === "saving" && <span className="hint">Kaydediliyor...</span>}
      {status === "saved" && <span style={{ color: "var(--success)", fontSize: 12, fontWeight: 600 }}>✓ Kaydedildi</span>}
      {status === "error" && <span style={{ color: "var(--danger)", fontSize: 12, fontWeight: 600 }}>✗ Kaydedilemedi</span>}
      {status === "invalid" && (
        <span style={{ color: "var(--danger)", fontSize: 12, fontWeight: 600 }}>✗ HS kodu 12 haneli sayı olmalı</span>
      )}
    </div>
  );
}
