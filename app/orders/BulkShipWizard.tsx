"use client";

import { useRef, useState } from "react";
import { LabelDownloadButton } from "./[postingNumber]/LabelDownloadButton";
import type { BulkShipEntry } from "./BulkShipContext";
import { WEIGHT_WARNING_TEXT } from "./weightWarningText";
import { shipPosting } from "./shipPosting";

interface ShipResult {
  postingNumber: string;
  outcome: "success" | "error" | "skipped";
  message?: string;
  syncedPostings?: string[];
}

async function shipOne(postingNumber: string, multiBoxQty?: number): Promise<ShipResult> {
  const res = await shipPosting(postingNumber, multiBoxQty);
  if (!res.ok) {
    return { postingNumber, outcome: "error", message: res.error };
  }
  return { postingNumber, outcome: "success", syncedPostings: res.syncedPostings };
}

// Toplu paketleme sihirbazı — önce UYARILI siparişleri (500g altı depo + toplam ürün adedi 1'den fazla)
// TEK TEK, kullanıcı onayıyla işler (2026-09-11, kullanıcı talebi: "toplu paketlemede eğer
// uyarılılar varsa önce uyarılı... tek tek işleme aldıran sıralı wizard"), sonra uyarısız
// kalanları TEK bir "N sipariş paketlenecek, onaylıyor musunuz?" onayıyla sırayla (paralel DEĞİL —
// gerçek Ozon isteklerini kontrollü hızda göndermek için) işler. Her iki grup da AYNI
// /api/orders/[postingNumber]/ship uç noktasını çağırıyor — kilitleme, güvenli-hata ayrımı gibi
// mevcut tüm koruma zaten orada, burada tekrarlanmıyor.
export function BulkShipWizard({
  entries,
  onFinish,
}: {
  entries: BulkShipEntry[];
  // Sihirbaz hangi aşamada kapatılırsa kapatılsın (erken "Tümünü İptal Et" dahil) AYNI callback
  // çağrılıyor — "iptal" anında bile önceki adımlarda GERÇEK paketleme isteği gitmiş olabilir, o
  // yüzden her kapanışta sayfa yenilenmeli (2026-09-11, kullanıcı talebi).
  onFinish: () => void;
}) {
  const [warnedQueue] = useState(() => entries.filter((e) => e.weightWarning));
  const [unwarnedQueue] = useState(() => entries.filter((e) => !e.weightWarning));
  const [warnedIndex, setWarnedIndex] = useState(0);
  const [phase, setPhase] = useState<"warned-step" | "unwarned-confirm" | "processing" | "done">(
    warnedQueue.length > 0 ? "warned-step" : unwarnedQueue.length > 0 ? "unwarned-confirm" : "done",
  );
  const [results, setResults] = useState<ShipResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [boxQtyInput, setBoxQtyInput] = useState("1");
  const [stepError, setStepError] = useState<string | null>(null);
  // Uyarılı adımda bir ship isteği başarısız olursa (Ozon reddetti / ağ hatası) burada gösteriliyor
  // — ÖNCEDEN hata da başarı gibi otomatik bir sonraki siparişe geçiliyordu, kullanıcı hatayı
  // fark etmeden tüm listeyi "başarılı sanıp" geçebiliyordu (2026-09-11'de code review'da tespit
  // edildi). Artık hata olduğunda burada durup kullanıcı "Tekrar Dene" ya da "Atla" seçiyor.
  const [lastError, setLastError] = useState<string | null>(null);
  const [processingLabel, setProcessingLabel] = useState<string | null>(null);
  // Uyarısız toplu işlem sırasında "Durdur" ile kesilebilsin diye — state DEĞİL ref, çünkü for
  // döngüsünün ortasında her iterasyonda ANINDA okunması gerekiyor, state güncellemesi asenkron
  // olduğu için bir sonraki render'a kadar eski değeri görebilirdi (2026-09-11'de code review'da
  // tespit edildi: döngü esnasında durdurma imkânı hiç yoktu).
  const stopRequested = useRef(false);

  function advanceAfterWarned(result: ShipResult) {
    setResults((prev) => [...prev, result]);
    setLastError(null);
    const nextIndex = warnedIndex + 1;
    // warnedIndex HER durumda (son sıradaki işlendiğinde bile) ilerletiliyor — aksi halde
    // warnedQueue.length'e ulaştığında eski değerinde (son işlenen sıra) TAKILI kalıyordu. Bu,
    // sonradan eklenen X kapatma düğmesi "unwarned-confirm" fazındayken de tıklanabildiği için
    // GERÇEK bir hataya yol açtı: handleCancelAll'daki warnedQueue.slice(warnedIndex) o zaman
    // ZATEN işlenmiş son uyarılı siparişi TEKRAR "atlandı" olarak ekliyordu — hatta gerçekten
    // paketlenmiş (success) bir siparişin sonucunu görünüşte çelişkili hale getiriyordu
    // (2026-09-11'de code review'da tespit edildi).
    setWarnedIndex(nextIndex);
    if (nextIndex < warnedQueue.length) {
      setBoxQtyInput("1");
      setStepError(null);
    } else if (unwarnedQueue.length > 0) {
      setPhase("unwarned-confirm");
    } else {
      setPhase("done");
    }
  }

  async function handleWarnedShip() {
    const current = warnedQueue[warnedIndex];
    const canSplit = current.totalQuantity > 1;
    let qty: number | undefined;
    if (canSplit) {
      const parsed = Number(boxQtyInput);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setStepError("Geçerli bir kutu sayısı girin (1 ya da daha büyük bir tam sayı).");
        return;
      }
      if (parsed > current.totalQuantity) {
        setStepError(`Bu siparişte toplam ${current.totalQuantity} adet var — en fazla ${current.totalQuantity} kutuya bölünebilir.`);
        return;
      }
      qty = parsed;
    }
    setStepError(null);
    setLastError(null);
    setBusy(true);
    const result = await shipOne(current.postingNumber, qty);
    setBusy(false);
    if (result.outcome === "error") {
      setLastError(result.message ?? "Paketlenemedi");
      return;
    }
    advanceAfterWarned(result);
  }

  function handleWarnedSkip() {
    advanceAfterWarned({ postingNumber: warnedQueue[warnedIndex].postingNumber, outcome: "skipped" });
  }

  async function handleUnwarnedConfirm() {
    setPhase("processing");
    stopRequested.current = false;
    for (const entry of unwarnedQueue) {
      if (stopRequested.current) {
        setResults((prev) => [...prev, { postingNumber: entry.postingNumber, outcome: "skipped" }]);
        continue;
      }
      setProcessingLabel(entry.postingNumber);
      const result = await shipOne(entry.postingNumber);
      setResults((prev) => [...prev, result]);
    }
    setProcessingLabel(null);
    setPhase("done");
  }

  function handleStopProcessing() {
    stopRequested.current = true;
  }

  function handleUnwarnedCancel() {
    setResults((prev) => [
      ...prev,
      ...unwarnedQueue.map((e): ShipResult => ({ postingNumber: e.postingNumber, outcome: "skipped" })),
    ]);
    setPhase("done");
  }

  // "Tümünü İptal Et" uyarılı adımlardan birindeyken tıklanırsa, o ana kadar işlenmiş siparişler
  // (varsa) GERÇEKTEN Ozon'a gitmiş olabilir — doğrudan onFinish() ile kapatıp o sonuçları
  // (etiket indirme linkleri dahil) göstermeden atlamak yerine, kalanları "atlandı" işaretleyip
  // normal "Tamamlandı" ekranına geçiyoruz ki kullanıcı ne olduğunu görsün (2026-09-11'de code
  // review'da tespit edildi — önceden results dizisi sessizce kayboluyordu).
  function handleCancelAll() {
    const remainingWarned = warnedQueue.slice(warnedIndex);
    setResults((prev) => [
      ...prev,
      ...remainingWarned.map((e): ShipResult => ({ postingNumber: e.postingNumber, outcome: "skipped" })),
      ...unwarnedQueue.map((e): ShipResult => ({ postingNumber: e.postingNumber, outcome: "skipped" })),
    ]);
    setPhase("done");
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div className="card" style={{ padding: 20, width: 480, maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Toplu Paketle</div>
          {/* Kullanıcı bu modalı ne yapacağını bilmeden kapattığında (2026-09-11'de gerçek bir
              kullanıcı tepkisi: "vazgeç yok x yok korktum") HİÇBİR YENİ sipariş işleme alınmadan
              direkt çıkabilsin diye — bu düğme "Paketle" ile karışmasın diye görsel olarak ayrık.
              DİKKAT: eğer bu wizard'daki ÖNCEKİ bir adımda gerçekten bir sipariş paketlendiyse
              (results içinde en az bir "success" varsa) bu GERİ ALINAMAZ — o yüzden başlık/tooltip
              o durumda "hiçbir şey yapma" YERİNE bunu açıkça belirtiyor (2026-09-11'de code
              review'da tespit edildi: önceden metin her durumda "hiçbir şey yapma" diyordu, bu da
              en az bir sipariş zaten paketlenmişken YANLIŞ bir güvence veriyordu). */}
          {phase !== "processing" && (
            <button
              type="button"
              // busy iken (tam da bir ship isteği havadayken) X'e basılırsa handleCancelAll o
              // siparişi "atlandı" işaretleyip "done" ekranına geçebilirdi — ama sonra havadaki
              // istek dönünce advanceAfterWarned yine de çalışıp AYNI siparişe ikinci, çelişkili
              // bir sonuç ekleyebilir, hatta bittiyse fazı yeniden "unwarned-confirm"e döndürüp
              // kullanıcı kapattığını sanırken sihirbazı sessizce yeniden açabilirdi — diğer tüm
              // butonlarla (Paketle/Atla/Kalanları İptal Et) AYNI şekilde disabled={busy} eklendi
              // (2026-09-11'de code review'da tespit edildi).
              disabled={busy}
              onClick={phase === "done" ? onFinish : handleCancelAll}
              title={
                results.some((r) => r.outcome === "success")
                  ? "Kapat — bazı siparişler bu sihirbazda ZATEN gerçekten paketlendi, bu GERİ ALINMAZ, sadece kalanları işlemeden kapatır"
                  : "Vazgeç, hiçbir sipariş paketlenmeden kapat"
              }
              aria-label="Kapat"
              style={{
                background: "none",
                border: "none",
                fontSize: 20,
                cursor: busy ? "default" : "pointer",
                color: "var(--text-secondary, #888)",
                lineHeight: 1,
                opacity: busy ? 0.4 : 1,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {phase === "warned-step" && (
          <>
            <div className="hint">
              Uyarılı sipariş {warnedIndex + 1} / {warnedQueue.length}
            </div>
            <div style={{ fontWeight: 500 }}>{warnedQueue[warnedIndex].postingNumber}</div>
            <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 500 }}>{WEIGHT_WARNING_TEXT}</div>
            {warnedQueue[warnedIndex].totalQuantity > 1 && (
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                Kaç kutuya bölünsün? (1 = bölme, en fazla {warnedQueue[warnedIndex].totalQuantity})
                <input
                  type="number"
                  min="1"
                  max={warnedQueue[warnedIndex].totalQuantity}
                  value={boxQtyInput}
                  onChange={(e) => setBoxQtyInput(e.target.value)}
                  style={{ width: 80 }}
                  disabled={busy}
                />
              </label>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn-primary" disabled={busy} onClick={handleWarnedShip}>
                {busy ? "Paketleniyor..." : lastError ? "Tekrar Dene" : "Paketle"}
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={handleWarnedSkip}>
                Atla
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={handleCancelAll}>
                Kalanları İptal Et
              </button>
            </div>
            {stepError && <div className="hint" style={{ color: "var(--danger)" }}>{stepError}</div>}
            {lastError && (
              <div className="hint" style={{ color: "var(--danger)" }}>
                ✗ Paketlenemedi: {lastError} — tekrar deneyebilir ya da atlayabilirsiniz.
              </div>
            )}
          </>
        )}

        {phase === "unwarned-confirm" && (
          <>
            <div>
              {unwarnedQueue.length} sipariş paketlenecek. Onaylıyor musunuz?
            </div>
            <div className="hint">Bu siparişlerde uyarı yok, tek kutu olarak (bölünmeden) paketlenecekler.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn-primary" onClick={handleUnwarnedConfirm}>
                Evet, Paketle
              </button>
              <button type="button" className="btn-secondary" onClick={handleUnwarnedCancel}>
                Vazgeç
              </button>
            </div>
          </>
        )}

        {phase === "processing" && (
          <>
            <div className="hint">
              Paketleniyor... {processingLabel ?? ""} ({Math.max(0, results.length - warnedQueue.length)}/{unwarnedQueue.length})
            </div>
            <button type="button" className="btn-secondary" onClick={handleStopProcessing}>
              Durdur (kalanları atla)
            </button>
          </>
        )}

        {phase === "done" && (
          <>
            <div style={{ fontWeight: 500 }}>Tamamlandı</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {results.map((r) => (
                <div key={r.postingNumber} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{r.postingNumber}</span>
                    <span
                      style={{
                        color:
                          r.outcome === "success" ? "var(--success)" : r.outcome === "skipped" ? undefined : "var(--danger)",
                      }}
                    >
                      {r.outcome === "success" ? "✓ Paketlendi" : r.outcome === "skipped" ? "Atlandı" : `✗ ${r.message}`}
                    </span>
                  </div>
                  {r.outcome === "success" && r.syncedPostings && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                      {r.syncedPostings.map((pn) => (
                        <div key={pn} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="hint" style={{ minWidth: 140 }}>{pn}</span>
                          <LabelDownloadButton postingNumber={pn} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={onFinish}
            >
              Tamam, sayfayı yenile
            </button>
          </>
        )}
      </div>
    </div>
  );
}
