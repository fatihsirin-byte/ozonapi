import { NextRequest, NextResponse } from "next/server";
import {
  submitOzonInvoice,
  fetchOzonInvoice,
  removeOzonInvoice,
  suggestHsCodesForOrder,
} from "@/modules/orders/orders.service";
import { OzonApiError } from "@/ozon/client";

export async function GET(_request: Request, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const decoded = decodeURIComponent(postingNumber);
  const [invoice, suggestedHsCodes] = await Promise.all([
    fetchOzonInvoice(decoded),
    suggestHsCodesForOrder(decoded),
  ]);
  return NextResponse.json({ invoice, suggestedHsCodes });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  const body = (await request.json()) as {
    fileBase64: string;
    number: string;
    date: string;
    price: number;
    priceCurrency: string;
    hsCodes: Array<{ code: string; sku: string }>;
  };

  try {
    const result = await submitOzonInvoice({ postingNumber: decodeURIComponent(postingNumber), ...body });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Fatura gönderilemedi";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ postingNumber: string }> }) {
  const { postingNumber } = await params;
  try {
    await removeOzonInvoice(decodeURIComponent(postingNumber));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof OzonApiError) {
      return NextResponse.json({ error: error.message, ozon: error.body }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : "Fatura silinemedi";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
