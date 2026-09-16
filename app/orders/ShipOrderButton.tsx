"use client";

import { useMemo, useRef, useState } from "react";
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
// PAKET EDİTÖRÜ (2026-09-16, kullanıcı talebi — önceki "Basit"/"Ürün Bazlı" iki ayrı modun
// yerine TEK bir akış): önce "kaç pakete bölünsün?" sorulur. Paket sayısı toplam adede eşitse
// (her pakette 1 adet) ya da 1 ise otomatik dağıtılıp doğrudan onaya sunulur; farklıysa her
// FİZİKSEL ADET ayrı bir kart olarak "Paketlenmeyenler" havuzunda gösterilir (bir ürünün yanında
// "2" yazıp kafa karıştırmak yerine — kullanıcı bulgusu: "bunu 2 ayrı ürün gibi göstersin") ve
// kullanıcı bunları paketlere sürükler/taşır. Backend zaten buna hazırdı (bkz. orders.service.ts
// shipOrder — Ozon'un packages dizisi keyfi gruplamayı destekliyordu).
interface UnitCard {
  cardId: string;
  offerId: string;
  name: string;
  image: string | null;
}

type Location = "unassigned" | number;

interface EditorState {
  unassigned: UnitCard[];
  packages: { id: number; cards: UnitCard[] }[];
}

function expandToUnitCards(items: ShipItem[]): UnitCard[] {
  const cards: UnitCard[] = [];
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      cards.push({ cardId: `${item.offerId}#${i}`, offerId: item.offerId, name: item.name, image: item.image });
    }
  }
  return cards;
}

// applyPackageCount (kutuyu uygulama) ve ship (gönderim öncesi son kontrol) AYNI kuralı iki
// yerde ayrı ayrı uygulasaydı, biri değişip diğeri unutulabilirdi (2026-09-16 code review'da
// "iki yerde ayrı doğrulama" olarak tespit edildi) — tek bir yerden.
function parsePackageCount(input: string, max: number): number | null {
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return null;
  return parsed;
}

function buildEditorState(cards: UnitCard[], packageCount: number): EditorState {
  const packages = Array.from({ length: packageCount }, (_, i) => ({ id: i, cards: [] as UnitCard[] }));
  // Tek paket varsa zaten tek bir yere gidebilir, seçim yapmaya gerek yok — hepsi otomatik.
  if (packageCount === 1) {
    packages[0].cards = [...cards];
    return { unassigned: [], packages };
  }
  // Paket sayısı toplam FİZİKSEL adede birebir eşitse (her pakette tam 1 adet) sırayla otomatik
  // dağıtılır — kullanıcı isterse yine de sürükleyip düzeltebilir, kilitli değil.
  if (packageCount === cards.length) {
    cards.forEach((c, i) => packages[i].cards.push(c));
    return { unassigned: [], packages };
  }
  // Farklıysa hiçbir varsayım yapılmaz — hepsi "Paketlenmeyenler" havuzunda başlar.
  return { unassigned: [...cards], packages };
}

function ShipmentPackageEditor({
  state,
  setState,
  onManualMove,
}: {
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  // Kullanıcı en az bir kartı elle taşıdığında tetiklenir — paket sayısı sonradan değişirse
  // otomatik yeniden dağıtımın bu elle yapılan işi ezmemesi için kullanılıyor (bkz. applyPackageCount).
  onManualMove: () => void;
}) {
  const dragRef = useRef<{ cardId: string; from: Location } | null>(null);

  function moveCard(cardId: string, from: Location, to: Location) {
    if (from === to) return;
    // Kartın gerçekten var olup olmadığını, setState'in updater'ı içinde değil, önce burada (o
    // anki `state` prop'una göre) kontrol ediyoruz — updater'ın içine bir yan etki (onManualMove
    // çağrısı) koymak, React'in state güncellemelerini ne zaman işleyeceğine güvenmek anlamına
    // gelirdi ki bu garanti değil. Bayat bir sürükleme olayı (ör. kart zaten başka bir yere
    // taşınmışken gecikmeli bir "drop" tetiklenirse) burada sessizce yok sayılır, hasCustomizedRef
    // kilidini gereksiz yere devreye sokmaz (2026-09-16 code review round 7).
    const source = from === "unassigned" ? state.unassigned : state.packages.find((p) => p.id === from)?.cards;
    if (!source?.some((c) => c.cardId === cardId)) return;
    setState((prev) => {
      const prevSource = from === "unassigned" ? prev.unassigned : prev.packages.find((p) => p.id === from)?.cards;
      const card = prevSource?.find((c) => c.cardId === cardId);
      if (!card) return prev;
      const unassigned = from === "unassigned" ? prev.unassigned.filter((c) => c.cardId !== cardId) : prev.unassigned;
      const packages = prev.packages.map((p) => {
        let cards = p.cards;
        if (p.id === from) cards = cards.filter((c) => c.cardId !== cardId);
        if (p.id === to) cards = [...cards, card];
        return { ...p, cards };
      });
      return { unassigned: to === "unassigned" ? [...unassigned, card] : unassigned, packages };
    });
    onManualMove();
  }

  function renderCard(card: UnitCard, from: Location) {
    // Hedef kutu seçimi — HTML5 sürükle-bırak dokunmatik ekranlarda (tablet/telefon) HİÇ
    // tetiklenmiyor (2026-09-15 code review'da tespit edildi) — bu menü her cihazda çalışan bir
    // alternatif sağlıyor, sürükleme sadece fare için hızlı bir kısayol.
    const destinations: Array<{ label: string; value: Location }> = [
      ...(from !== "unassigned" ? [{ label: "Paketlenmeyenler", value: "unassigned" as Location }] : []),
      ...state.packages.filter((p) => p.id !== from).map((p) => ({ label: `Paket ${p.id + 1}`, value: p.id as Location })),
    ];
    return (
      <div
        key={card.cardId}
        draggable
        onDragStart={() => (dragRef.current = { cardId: card.cardId, from })}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", cursor: "grab", flexWrap: "wrap" }}
      >
        {card.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.image} alt="" width={28} height={28} style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
        ) : (
          <div style={{ width: 28, height: 28, background: "var(--border)", borderRadius: 4, flexShrink: 0 }} />
        )}
        <span style={{ fontSize: 12, flex: 1, minWidth: 90 }}>{card.name}</span>
        <select
          value=""
          onChange={(e) => {
            const value = e.target.value;
            if (!value) return;
            moveCard(card.cardId, from, value === "unassigned" ? "unassigned" : Number(value));
            e.target.value = "";
          }}
          style={{ fontSize: 11, maxWidth: 140 }}
        >
          <option value="">Taşı...</option>
          {destinations.map((d) => (
            <option key={String(d.value)} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const drag = dragRef.current;
          dragRef.current = null;
          if (drag) moveCard(drag.cardId, drag.from, "unassigned");
        }}
        style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 8 }}
      >
        <strong style={{ fontSize: 12 }}>Paketlenmeyenler</strong>
        {state.unassigned.length === 0 ? (
          <div className="hint" style={{ fontSize: 12, marginTop: 4 }}>Hepsi paketlere atandı.</div>
        ) : (
          <div style={{ marginTop: 4 }}>{state.unassigned.map((c) => renderCard(c, "unassigned"))}</div>
        )}
      </div>
      {state.packages.map((pkg) => (
        <div
          key={pkg.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const drag = dragRef.current;
            dragRef.current = null;
            if (drag) moveCard(drag.cardId, drag.from, pkg.id);
          }}
          style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 8 }}
        >
          <strong style={{ fontSize: 12 }}>Paket {pkg.id + 1}</strong>
          {pkg.cards.length === 0 ? (
            <div className="hint" style={{ fontSize: 12, marginTop: 4 }}>Boş — buraya ürün sürükleyin</div>
          ) : (
            <div style={{ marginTop: 4 }}>{pkg.cards.map((c) => renderCard(c, pkg.id))}</div>
          )}
        </div>
      ))}
      <div className="hint" style={{ fontSize: 11 }}>
        Fare ile sürükleyebilir ya da her ürünün yanındaki "Taşı..." menüsünü kullanabilirsiniz (dokunmatik
        ekranlarda sürükleme çalışmaz, menüyü kullanın).
      </div>
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
  // Paket editörü için — sipariş kalemlerinin görsel/ad bilgisi.
  items: ShipItem[];
}) {
  const router = useRouter();
  const canSplit = totalQuantity > 1;
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const allCards = useMemo(() => expandToUnitCards(items), [items]);
  const [packageCountInput, setPackageCountInput] = useState("1");
  const [editorState, setEditorState] = useState<EditorState>(() => buildEditorState(allCards, 1));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string[] | null>(null);
  // Kullanıcı elle en az bir kartı taşıyana kadar false — bu süre boyunca paket sayısı her
  // değiştiğinde sıfırdan otomatik dağıtım (buildEditorState) güvenle kullanılabilir. İlk elle
  // taşımadan SONRA true'ya döner ve bir daha false olmaz — o andan itibaren paket sayısı
  // değişse bile mevcut elle yerleştirmelere ASLA otomatik olarak dokunulmaz (2026-09-16 code
  // review round 6'da "otomatik doldurma, kullanıcının bilerek 'Paketlenmeyenler'e bıraktığı bir
  // kartı da geri paketleyebiliyor" bulgusuna karşılık).
  const hasCustomizedRef = useRef(false);

  function applyPackageCount() {
    const parsed = parsePackageCount(packageCountInput, totalQuantity);
    if (parsed == null) {
      setError(
        `Geçerli bir paket sayısı girin (1 ile ${totalQuantity} arasında bir tam sayı — siparişte toplam ${totalQuantity} adet var).`,
      );
      return;
    }
    setError(null);
    // Kutudaki metni uygulanan sayının KANONİK haline eşitliyoruz (ör. "03" yazılmışsa "3"
    // yapıyoruz) — aksi halde gönderim öncesi kontrol (ship() içinde) yazılan metni
    // editorState.packages.length ile birebir karşılaştırırken, geçerli ve uygulanmış bir girişi
    // bile "önce Uygula'ya bas" diyerek reddedebilirdi (2026-09-16 code review round 6'da tespit
    // edildi).
    setPackageCountInput(String(parsed));
    setEditorState((prev) => {
      const currentCount = prev.packages.length;
      if (parsed === currentCount) return prev;
      if (!hasCustomizedRef.current) {
        // Henüz elle hiçbir kart taşınmadı — sıfırdan otomatik dağıtım (1'e bir, ya da tek
        // pakete toplama) güvenle kullanılabilir.
        return buildEditorState(allCards, parsed);
      }
      // Kullanıcı en az bir kartı elle taşımış — mevcut yerleşimi KORUYORUZ, sadece paket
      // sayısını büyütüp küçültüyoruz. Büyütürken sona boş paket(ler) ekleniyor; küçültürken
      // fazla paketlerin içindeki kartlar silinmiyor, "Paketlenmeyenler"e geri dönüyor. Otomatik
      // doldurma burada YOK — "Paketlenmeyenler"de duran bir kart kullanıcı bilerek orada
      // bırakmış olabilir, sessizce bir pakete geri atanmıyor.
      let packages = prev.packages.map((p) => ({ id: p.id, cards: [...p.cards] }));
      let unassigned = prev.unassigned;
      if (parsed > currentCount) {
        for (let i = currentCount; i < parsed; i++) packages.push({ id: i, cards: [] });
      } else {
        const removed = packages.slice(parsed);
        packages = packages.slice(0, parsed);
        unassigned = [...unassigned, ...removed.flatMap((p) => p.cards)];
      }
      return { unassigned, packages };
    });
  }

  async function ship() {
    setError(null);
    let customGroups: CustomShipGroup[][] | undefined;
    if (canSplit) {
      // Kullanıcı paket sayısı kutusuna yeni bir değer YAZIP (geçerli ya da geçersiz — ör. boş
      // bıraktı ya da harf yazdı) "Uygula"ya basmadan doğrudan "Evet, Paketle"ye basarsa, editör
      // hâlâ ESKİ (uygulanmamış) düzeni gösterirdi — GERÇEK, geri alınamaz bir sevkiyat kullanıcının
      // az önce yazdığı sayıyla değil, eski düzenle giderdi (2026-09-16 code review'da tespit
      // edildi). Kutudaki METİN, en son uygulanmış paket sayısıyla BİREBİR eşleşmiyorsa (geçersiz
      // girişler dahil) durduruyoruz — güvenli taraf hep "önce Uygula'ya bas" demek.
      if (packageCountInput.trim() !== String(editorState.packages.length)) {
        setError('Paket sayısını değiştirdiniz ama henüz "Uygula"ya basmadınız — önce uygulayın.');
        return;
      }
      if (editorState.unassigned.length > 0) {
        setError('Önce tüm ürünleri bir pakete atayın ("Paketlenmeyenler" boş olmalı).');
        return;
      }
      const nonEmptyPackages = editorState.packages.filter((p) => p.cards.length > 0);
      if (nonEmptyPackages.length === 0) {
        setError("En az bir pakette ürün olmalı.");
        return;
      }
      // Kart bazlı editörden (her fiziksel adet ayrı kart) backend'in beklediği {offerId,
      // quantity} biçimine dönüştürülüyor — aynı üründen birden fazla kart aynı pakette
      // birleştiriliyor.
      customGroups = nonEmptyPackages.map((p) => {
        const byOfferId = new Map<string, number>();
        for (const c of p.cards) byOfferId.set(c.offerId, (byOfferId.get(c.offerId) ?? 0) + 1);
        return [...byOfferId.entries()].map(([offerId, quantity]) => ({ offerId, quantity }));
      });
    }
    setLoading(true);
    const res = await shipPosting(postingNumber, { customGroups });
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
    <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 280, maxWidth: 440 }}>
      <div style={{ fontWeight: 500 }}>Bu siparişi paketle ve Ozon'a bildir</div>
      <div className="hint">Bu işlem Ozon'a GERÇEK bir sevkiyat onayı gönderir, geri alınamaz.</div>
      {weightWarning && (
        <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 500 }}>{WEIGHT_WARNING_TEXT}</div>
      )}
      {canSplit && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13 }}>Kaç pakete bölünsün? (en fazla {totalQuantity})</label>
            <input
              type="number"
              min={1}
              max={totalQuantity}
              value={packageCountInput}
              onChange={(e) => setPackageCountInput(e.target.value)}
              style={{ width: 56 }}
            />
            <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={applyPackageCount}>
              Uygula
            </button>
          </div>
          <ShipmentPackageEditor
            state={editorState}
            setState={setEditorState}
            onManualMove={() => {
              hasCustomizedRef.current = true;
            }}
          />
        </>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={
            loading ||
            (canSplit &&
              (editorState.unassigned.length > 0 ||
                packageCountInput.trim() !== String(editorState.packages.length)))
          }
          onClick={ship}
        >
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
