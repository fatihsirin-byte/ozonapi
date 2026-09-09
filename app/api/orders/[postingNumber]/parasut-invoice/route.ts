import { NextRequest, NextResponse } from "next/server";
import { createInvoiceForOzonOrder, OrderInvoiceError } from "@/parasut/orderInvoice";
import { ParasutApiError } from "@/parasut/client";

// "Fatura Kes" butonu — Paraşüt'te GERÇEK bir satış faturası oluşturur (bkz. orderInvoice.ts).
// Sipariş zaten faturalandıysa yeniden kesmez, var olan bilgiyi döner (idempotent).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  try {
    const result = await createInvoiceForOzonOrder(decodeURIComponent(postingNumber));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OrderInvoiceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ParasutApiError) {
      return NextResponse.json({ error: error.message, body: error.body }, { status: error.status ?? 502 });
    }
    throw error;
  }
}
