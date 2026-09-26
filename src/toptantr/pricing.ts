import { env } from "../config/env";

// TL = USD * kur * (1 + (temel marj% + ekstra marj%)/100) — VPS'teki orijinal projeyle aynı formül.
export function usdToTl(usdPrice: number | string | null | undefined, extraMarginPercent = 0): number {
  const price = parseFloat(String(usdPrice ?? "0")) || 0;
  const tl = price * env.toptantrUsdToTlRate * (1 + (env.toptantrMarginPercent + extraMarginPercent) / 100);
  return Math.round(tl * 100) / 100;
}
