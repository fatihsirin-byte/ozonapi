import { NextRequest, NextResponse } from "next/server";
import { syncReturns, syncRfbsReturns } from "@/modules/returns/returns.service";
import { OzonApiError } from "@/ozon/client";

// Elle "Senkronize Et" butonu için — varsayılan son 90 gün. Aynı işlem cron ile de periyodik
// çalışıyor (bkz. src/scripts/sync-orders-cron.ts). syncRfbsReturns (2026-09-18, kullanıcı bulgusu)
// bu hesabın gerçek veri kaynağı — /v1/returns/list (syncReturns) bu hesap için hep boş dönüyor
// (yanlış şema), yine de zararsız olduğu için siliniyor değil ikisi birden çağrılıyor.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { since?: string; to?: string };
  const to = body.to ? new Date(body.to) : new Date();
  const since = body.since ? new Date(body.since) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    const count = await syncReturns({ since, to });
    const rfbsCount = await syncRfbsReturns();
    return NextResponse.json({ count, rfbsCount });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    throw error;
  }
}
