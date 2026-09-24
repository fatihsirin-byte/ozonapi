import { NextRequest, NextResponse } from "next/server";
import { createInvoiceForOzonOrder, OrderInvoiceError } from "@/parasut/orderInvoice";
import { ParasutApiError } from "@/parasut/client";
import { sendOrderToAse } from "@/ase/orderShipment";
import { prisma } from "@/db/prisma";

interface BulkResult {
  postingNumber: string;
  invoiceSuccess: boolean;
  invoiceError: string | null;
  aseSuccess: boolean | null;
}

// "Toplu Fatura + ASE" — seçili siparişleri TEK TEK, SIRAYLA işler (2026-09-23, kullanıcı talebi).
// Paralel DEĞİL: tek bir sipariş faturası bile birden çok Paraşüt isteği zincirliyor (kontak +
// N ürün + fatura + e-Arşiv, bkz. orderInvoice.ts) — hepsini paralel patlatmak Paraşüt'ün 429 hız
// sınırına toplu çarpma riskini büyük ölçüde artırırdı (bkz. src/parasut/client.ts yorumu, aynı
// sınıftan geçmiş bir olay). createInvoiceForOzonOrder zaten idempotent (sipariş faturalıysa
// yeniden kesmez) — bu yüzden burada AYRICA bir "zaten faturalı mı" kontrolü yapılmıyor.
//
// ASE gönderimi burada BEST-EFFORT: sendOrderToAse, fatura numarası henüz GİB tarafından
// onaylanmadıysa (parasutInvoiceNoConfirmed) sessizce hiçbir şey yapmaz (bkz. orderShipment.ts) —
// bu NORMAL, tek seferlik bir fatura kesiminden hemen sonra numara genelde henüz kesinleşmemiş
// olur. Onaylandığında ASE gönderimi zaten sync-orders-cron.ts'teki runAseAutoSend tarafından
// birkaç dakika içinde otomatik yapılır — burada denemek sadece ZATEN onaylıysa (ör. sipariş daha
// önce faturalanmış) anında sonuç almayı sağlıyor.
const BATCH_DELAY_MS = 1000;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const postingNumbers = Array.isArray(body.postingNumbers) ? body.postingNumbers.filter((p: unknown) => typeof p === "string") : [];

  if (postingNumbers.length === 0) {
    return NextResponse.json({ error: "postingNumbers boş olamaz" }, { status: 400 });
  }

  const results: BulkResult[] = [];
  for (const postingNumber of postingNumbers) {
    let invoiceSuccess = false;
    let invoiceError: string | null = null;
    try {
      await createInvoiceForOzonOrder(postingNumber);
      invoiceSuccess = true;
    } catch (error) {
      if (error instanceof OrderInvoiceError) {
        invoiceError = error.message;
      } else if (error instanceof ParasutApiError) {
        invoiceError = error.message;
      } else {
        invoiceError = error instanceof Error ? error.message : "Bilinmeyen hata";
      }
    }

    let aseSuccess: boolean | null = null;
    if (invoiceSuccess) {
      try {
        await sendOrderToAse(postingNumber);
        const order = await prisma.order.findUnique({ where: { postingNumber }, select: { aseShipmentSuccess: true } });
        aseSuccess = order?.aseShipmentSuccess ?? null;
      } catch (error) {
        console.error(`[bulk-invoice-ase] ASE gönderim hatası (posting ${postingNumber}):`, error);
      }
    }

    results.push({ postingNumber, invoiceSuccess, invoiceError, aseSuccess });
    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
  }

  return NextResponse.json({ results });
}
