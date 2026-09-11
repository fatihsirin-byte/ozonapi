// ShipOrderButton.tsx (tekli "Topla") ve BulkShipWizard.tsx (toplu paketleme) AYNI
// /api/orders/[postingNumber]/ship isteğini AYNI şekilde yorumlamalı — özellikle
// data.syncedPostings boşsa bile en az orijinal postingNumber'ı döndürme kuralı — bu yüzden tek
// bir yerden paylaşılıyor (2026-09-11'de code review'da tespit edildi: bu mantık iki dosyada ayrı
// ayrı kopyalanmıştı, biri düzelip diğeri unutulabilirdi — WEIGHT_WARNING_TEXT'te de aynı sorun
// yaşanmıştı).
export interface ShipPostingResult {
  ok: boolean;
  syncedPostings?: string[];
  error?: string;
}

export async function shipPosting(postingNumber: string, multiBoxQty?: number): Promise<ShipPostingResult> {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(postingNumber)}/ship`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ multiBoxQty }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Paketlenemedi" };
    }
    // BİLEREK data.postingNumbers DEĞİL data.syncedPostings kullanılıyor — postingNumbers, Ozon'un
    // ham ship cevabının (hiç canlıda doğrulanmamış) ayrıştırılmasından geliyor ve boş çıkabilir;
    // syncedPostings ise shipOrder'ın GERÇEKTEN senkronize ettiği (en azından orijinal posting'i
    // içeren) liste — hep en az bir posting içerir (2026-09-11'de code review'da tespit edildi: boş
    // dizi gelirse kullanıcı hiç etiket indirme butonu göremiyordu).
    const syncedPostings: string[] = data.syncedPostings?.length > 0 ? data.syncedPostings : [postingNumber];
    return { ok: true, syncedPostings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Bilinmeyen hata" };
  }
}
