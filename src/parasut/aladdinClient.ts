import { env } from "../config/env";
import { createParasutClient, ParasutApiError, type ParasutAccountConfig } from "./client";

// Aladdin Turkey Dış Ticaret Limited Şirketi'nin AYRI Paraşüt hesabı — Fatih Gezgin'e (Ozon'a
// satış yapan tarafın kendi şirketi) günlük iç fatura kesmek için (2026-09-16, kullanıcı talebi).
// Fatih Gezgin'in kontağı bu hesapta ZATEN kayıtlı (contact id 1052686564, vergi no 61060090608) —
// 2025-12'den beri aralarında gerçek faturalar kesilmiş, o gerçek örneklerin BİREBİR aynı şekli
// (TL, %1 KDV, "plain" fatura — e-Arşiv/e-Fatura adımı YOK, is_abroad=false) burada da kullanılıyor
// (bkz. src/parasut/aladdinInvoice.ts).
function requireAladdin2Config(): ParasutAccountConfig {
  const missing = (
    [
      ["PARASUT2_CLIENT_ID", env.parasut2ClientId],
      ["PARASUT2_CLIENT_SECRET", env.parasut2ClientSecret],
      ["PARASUT2_USERNAME", env.parasut2Username],
      ["PARASUT2_PASSWORD", env.parasut2Password],
      ["PARASUT2_COMPANY_ID", env.parasut2CompanyId],
    ] as const
  ).filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new ParasutApiError(
      `Aladdin Paraşüt entegrasyonu için eksik .env değişkenleri: ${missing.map(([name]) => name).join(", ")}`,
      undefined,
      null,
    );
  }

  return {
    clientId: env.parasut2ClientId!,
    clientSecret: env.parasut2ClientSecret!,
    username: env.parasut2Username!,
    password: env.parasut2Password!,
    companyId: env.parasut2CompanyId!,
    redirectUri: env.parasut2RedirectUri,
    baseUrl: env.parasut2BaseUrl,
  };
}

const aladdinClient = createParasutClient(requireAladdin2Config);

export const parasut2Get = aladdinClient.parasutGet;
export const parasut2Post = aladdinClient.parasutPost;
export const parasut2Put = aladdinClient.parasutPut;
export const parasut2Delete = aladdinClient.parasutDelete;
