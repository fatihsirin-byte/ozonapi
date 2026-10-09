import { env } from "../config/env";

// toptantr satış fiyatı = alış (maliyet) × %10 (kullanıcı kararı, 2026-10-09). Tüm kademelerde (Adet/Paket/Koli)
// aynı oran: kademenin maliyeti zaten paket içi adetle çarpılmış olduğundan ekstra kademe marjı yok.
// Ozon fiyatından bağımsız; env'deki TOPTANTR_MARGIN_PERCENT artık fiyatı etkilemez.
export const TOPTANTR_MARKUP_PERCENT = 10;

// TL = USD * kur * 1.10
export function usdToTl(usdPrice: number | string | null | undefined): number {
  const price = parseFloat(String(usdPrice ?? "0")) || 0;
  const tl = price * env.toptantrUsdToTlRate * (1 + TOPTANTR_MARKUP_PERCENT / 100);
  return Math.round(tl * 100) / 100;
}
