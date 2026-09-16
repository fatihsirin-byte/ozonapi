"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { LabelDownloadButton } from "./[postingNumber]/LabelDownloadButton";
import { WEIGHT_WARNING_TEXT } from "./weightWarningText";
import { shipPosting, type CustomShipGroup } from "./shipPosting";

interface ShipItem {
  offerId: string;
  quantity: number;
  name: string;
  image: string | null;
}

// Ozon panelinde "Topla" dendiğinde kutuya bölme seçeneği SADECE paketteki toplam ürün adedi
// 1'den fazlaysa çıkıyor (kullanıcı notu, bkz. BEKLEYEN-GELISTIRMELER.md #3) — burada da aynı
// davranış taklit ediliyor.
//
// ÜRÜN BAZLI (sürükle-bırak) BÖLME (2026-09-15, kullanıcı talebi: "Ozon'da gönderi bölme ürün
// bazlı da yapılabiliyor, bizde de olsun"): "Basit" mod eskisi gibi eşit dağıtım yapan
// multiBoxQty'yi kullanır; "Ürün Bazlı" modda kullanıcı her ürünü (isterse adedinin bir kısmını)
// istediği kutuya sürükleyip bırakır — tam Ozon'un kendi panelindeki gibi. Backend zaten buna
// hazırdı (bkz. orders.service.ts shipOrder — Ozon'un packages dizisi her zaman keyfi
// gruplamayı destekliyordu, sadece UI eşit dağıtımla sınırlıydı).
// Gruplar DİZİ İNDEKSİYLE değil KARARLI bir id ile tutuluyor (2026-09-15 code review'da tespit
// edildi): boş bir kutu "Kaldır" ile silinince sonraki kutuların indeksi kayardı, bu da hem
// "Kutu 1 (orijinal)" etiketinin başka bir kutuya geçmesine hem de aşağıdaki dragAmounts'ın
// (indekse göre anahtarlanmışsa) yanlış satırla eşleşmesine yol açardı.
interface ShipGroup {
  id: number;
  items: ShipItem[];
}

function keyOf(groupId: number, offerId: string) {
  return `${groupId}:${offerId}`;
}

function ShipmentGroupEditor({
  items,
  groups,
  setGroups,
}: {
  items: ShipItem[];
  groups: ShipGroup[];
  setGroups: React.Dispatch<React.SetStateAction<ShipGroup[]>>;
}) {
  const [dragAmounts, setDragAmounts] = useState<Record<string, number>>({});
  const dragRef = useRef<{ fromGroupId: number; offerId: string; qty: number } | null>(null);

  // Yeni kutunun id'si mevcut en büyük id + 1 — ayrı bir sayaç (ref) tutmaya gerek yok, State zaten
  // tek doğruluk kaynağı.
  function nextGroupId(current: ShipGroup[]): number {
    return current.reduce((max, g) => Math.max(max, g.id), -1) + 1;
  }

  function moveUnits(fromGroupId: number, offerId: string, qty: number, toGroupId: number | "new") {
    if (qty <= 0) return;
    setGroups((prev) => {
      let next = prev.map((g) => ({ id: g.id, items: g.items.map((it) => ({ ...it })) }));
      const targetId = toGroupId === "new" ? nextGroupId(next) : toGroupId;
      if (toGroupId === "new") next = [...next, { id: targetId, items: [] }];
      if (targetId === fromGroupId) return prev;
      const sourceGroup = next.find((g) => g.id === fromGroupId);
      const destGroup = next.find((g) => g.id === targetId);
      if (!sourceGroup || !destGroup) return prev;
      const srcIdx = sourceGroup.items.findIndex((it) => it.offerId === offerId);
      if (srcIdx === -1) return prev;
      const src = sourceGroup.items[srcIdx];
      const moveQty = Math.min(qty, src.quantity);
      const snapshot = { offerId: src.offerId, name: src.name, image: src.image };
      src.quantity -= moveQty;
      if (src.quantity <= 0) sourceGroup.items.splice(srcIdx, 1);

      const destIdx = destGroup.items.findIndex((it) => it.offerId === offerId);
      if (destIdx >= 0) destGroup.items[destIdx].quantity += moveQty;
      else destGroup.items.push({ ...snapshot, quantity: moveQty });

      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.map((group, gi) => (
        <div
          key={group.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const drag = dragRef.current;
            dragRef.current = null;
            if (drag) moveUnits(drag.fromGroupId, drag.offerId, drag.qty, group.id);
          }}
          style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 8 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            {/* "orijinal" etiketi id 0'a (İLK oluşturulan kutuya) bağlı, DİZİ İNDEKSİNE (gi) değil
                — aksi halde id 0'lı kutu boşalıp kaldırılınca yerine geçen kutu yanlışlıkla
                "orijinal" görünürdü (2026-09-15 code review'da tespit edildi, tam olarak stabil
                id'lere geçişin önlemeye çalıştığı sorun). Sıra numarası (gi+1) yine de dizideki
                GÖRÜNÜR konumdan geliyor, sadece etiket metni id'ye bağlı. */}
            <strong style={{ fontSize: 12 }}>{group.id === 0 ? `Kutu ${gi + 1} (orijinal)` : `Kutu ${gi + 1}`}</strong>
            {group.items.length === 0 && groups.length > 1 && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 11, padding: "2px 6px" }}
                onClick={() => setGroups((prev) => prev.filter((g) => g.id !== group.id))}
              >
                Kaldır
              </button>
            )}
          </div>
          {group.items.length === 0 ? (
            <div className="hint" style={{ fontSize: 12 }}>Boş — buraya ürün sürükleyin ya da aşağıdan taşıyın</div>
          ) : (
            group.items.map((it) => {
              const k = keyOf(group.id, it.offerId);
              const dragAmount = Math.max(1, Math.min(dragAmounts[k] ?? it.quantity, it.quantity));
              // Hedef kutu seçimi — HTML5 sürükle-bırak dokunmatik ekranlarda (tablet/telefon) HİÇ
              // tetiklenmiyor (2026-09-15 code review'da tespit edildi: kullanıcı bölmeye çalışsa
              // bile hiçbir şey olmuyor, sessizce bölünmemiş tek kutu gönderiliyordu) — bu açılır
              // menü her cihazda çalışan bir alternatif sağlıyor, sürükleme sadece fare için hızlı bir kısayol.
              const otherGroups = groups.filter((g) => g.id !== group.id);
              return (
                <div
                  key={it.offerId}
                  draggable
                  onDragStart={() => (dragRef.current = { fromGroupId: group.id, offerId: it.offerId, qty: dragAmount })}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", cursor: "grab", flexWrap: "wrap" }}
                >
                  {it.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image} alt="" width={32} height={32} style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 32, height: 32, background: "var(--border)", borderRadius: 4, flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 12, flex: 1, minWidth: 100 }}>{it.name}</span>
                  {it.quantity > 1 && (
                    // Eskiden 44px genişlikti — tarayıcının yerleşik yukarı/aşağı okları dar
                    // kutuda rakamı görünmez hale getiriyordu (2026-09-16, kullanıcı bulgusu:
                    // "inputtaki 2 gözükmüyor"). Ayrıca ne anlama geldiği (taşınacak adet) net
                    // değildi, kısa bir etiket eklendi.
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                      <span className="hint">Taşınacak:</span>
                      <input
                        type="number"
                        min={1}
                        max={it.quantity}
                        value={dragAmount}
                        onChange={(e) =>
                          setDragAmounts((prev) => ({
                            ...prev,
                            [k]: Math.max(1, Math.min(it.quantity, Number(e.target.value) || 1)),
                          }))
                        }
                        title="Kaç adet taşınacak"
                        style={{ width: 64, fontSize: 13, textAlign: "center" }}
                      />
                    </span>
                  )}
                  <span className="hint" style={{ fontSize: 11 }}>/{it.quantity} adet</span>
                  <select
                    value=""
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) return;
                      moveUnits(group.id, it.offerId, dragAmount, value === "new" ? "new" : Number(value));
                      e.target.value = "";
                    }}
                    style={{ fontSize: 11, maxWidth: 120 }}
                  >
                    <option value="">Taşı...</option>
                    {otherGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {groups.findIndex((x) => x.id === g.id) === 0 ? "Kutu 1" : `Kutu ${groups.findIndex((x) => x.id === g.id) + 1}`}
                      </option>
                    ))}
                    <option value="new">+ Yeni kutu</option>
                  </select>
                </div>
              );
            })
          )}
        </div>
      ))}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const drag = dragRef.current;
          dragRef.current = null;
          if (drag) moveUnits(drag.fromGroupId, drag.offerId, drag.qty, "new");
        }}
        className="hint"
        style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 10, textAlign: "center", fontSize: 12 }}
      >
        + Yeni kutu oluşturmak için ürünü buraya sürükleyin (ya da bir üründeki "Taşı..." menüsünden "+ Yeni kutu" seçin)
      </div>
      {items.length > 0 && (
        <div className="hint" style={{ fontSize: 11 }}>
          Adet birden fazlaysa, taşımadan önce yanındaki sayıyı değiştirip kaç tanesinin taşınacağını seçebilirsiniz.
          Fare ile sürükleyebilir ya da "Taşı..." menüsünü kullanabilirsiniz (dokunmatik ekranlarda sürükleme
          çalışmaz, menüyü kullanın).
        </div>
      )}
    </div>
  );
}

export function ShipOrderButton({
  postingNumber,
  totalQuantity,
  locked,
  weightWarning,
  items,
}: {
  postingNumber: string;
  totalQuantity: number;
  // Önceki bir "Topla" denemesi belirsiz kaldıysa (bkz. shipOrder'daki shipClaimedAt kilidi) bu
  // sipariş kilitli kalmış demektir — butonu göstermek yerine ne yapılması gerektiğini
  // açıklıyoruz, aksi halde kullanıcı tekrar tıklayıp hep aynı hatayı alır (2026-09-10'da code
  // review'da tespit edildi).
  locked?: boolean;
  // Sipariş "500g altı" lojistik deposundan geldi ve toplam ürün adedi 1'den fazla (aynı ürünün
  // 2+ adedi de, farklı ürünlerin toplamı da dahil) — tek kutuda paketlenirse toplam ağırlık
  // 500g'ı geçip teslimat sorununa yol açabilir (bkz. orders.service.ts getWeightSplitWarning).
  weightWarning?: boolean;
  // Ürün bazlı (sürükle-bırak) bölme editörü için — sipariş kalemlerinin görsel/ad bilgisi.
  items: ShipItem[];
}) {
  const router = useRouter();
  const canSplit = totalQuantity > 1;
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  // Varsayılan "Ürün Bazlı" (2026-09-16, kullanıcı talebi) — Ozon panelindeki gibi sürükle-bırak
  // yeni sistem asıl beklenen davranış, "Basit" (eşit dağıtım) sadece hızlı bir alternatif olarak
  // kalıyor, ilk açılışta seçili olmasın diye.
  const [mode, setMode] = useState<"simple" | "custom">("custom");
  const [multiBoxQty, setMultiBoxQty] = useState("1");
  const [groups, setGroups] = useState<ShipGroup[]>(() => [{ id: 0, items: items.map((it) => ({ ...it })) }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string[] | null>(null);

  async function ship() {
    setError(null);
    let qty: number | undefined;
    let customGroups: CustomShipGroup[][] | undefined;
    if (canSplit && mode === "simple") {
      // Sayı olmayan/geçersiz bir kutu sayısı GİRİLDİYSE sessizce bölmesiz devam etmek yerine
      // durduruyoruz — aksi halde kullanıcı bölme istediğini sanırken sipariş tek kutu olarak
      // paketlenebilirdi (2026-09-10'da code review'da tespit edildi).
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
    } else if (canSplit && mode === "custom") {
      const nonEmpty = groups.filter((g) => g.items.length > 0);
      if (nonEmpty.length === 0) {
        setError("En az bir kutuda ürün olmalı.");
        return;
      }
      customGroups = nonEmpty.map((g) => g.items.map(({ offerId, quantity }) => ({ offerId, quantity })));
    }
    setLoading(true);
    const res = await shipPosting(postingNumber, { multiBoxQty: qty, customGroups });
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
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 260, maxWidth: 420 }}>
      <div style={{ fontWeight: 500 }}>Bu siparişi paketle ve Ozon'a bildir</div>
      <div className="hint">Bu işlem Ozon'a GERÇEK bir sevkiyat onayı gönderir, geri alınamaz.</div>
      {weightWarning && (
        <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 500 }}>{WEIGHT_WARNING_TEXT}</div>
      )}
      {canSplit && (
        <>
          <div className="segmented-toggle" role="group" aria-label="Bölme yöntemi" style={{ alignSelf: "flex-start" }}>
            <button type="button" className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")}>
              Basit
            </button>
            <button type="button" className={mode === "custom" ? "active" : ""} onClick={() => setMode("custom")}>
              Ürün Bazlı
            </button>
          </div>
          {mode === "simple" ? (
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
          ) : (
            <ShipmentGroupEditor items={items} groups={groups} setGroups={setGroups} />
          )}
        </>
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
