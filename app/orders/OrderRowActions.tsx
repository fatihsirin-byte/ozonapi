"use client";

import { useRef } from "react";
import { InvoiceAndAseButton, InvoiceAndAseButtonHandle } from "./InvoiceAndAseButton";

interface Props {
  postingNumber: string;
  orderStatus: string;
  initialInvoiceNo: string | null;
  initialPrintUrl: string | null;
  initialInvoiceConfirmed: boolean;
  initialPdfCached: boolean;
  initialAseSentAt: string | null;
  initialAseSuccess: boolean | null;
  initialAseMessage: string | null;
}

// "Etiket Yazdır" + "Fatura + ASE"yi TEK satırda birleştiriyor (2026-09-25, kullanıcı talebi:
// "etiket yazdırınca fatura ve aseyi tetiklesin ... aşağıda fatura ase butonu kaybolur yani job
// başlar"). İkisi ayrı bileşen olduğu için (InvoiceAndAseButton kendi state'ini kendi içinde
// tutuyor), etiketin tıklamasının fatura+ASE'yi başlatabilmesi için ARADA bir bağlantıya
// (InvoiceAndAseButtonHandle ref'i) ihtiyaç var — bu bileşen sadece o bağlantıyı kuruyor, kendi
// başına ekstra bir görünüm eklemiyor.
export function OrderRowActions({ postingNumber, orderStatus, ...invoiceProps }: Props) {
  const invoiceRef = useRef<InvoiceAndAseButtonHandle>(null);

  return (
    <div>
      {/* Ozon'un etiket API'si SADECE "awaiting_deliver" (Kargoya Hazır) durumunda çalışıyor (bkz.
          app/api/orders/[postingNumber]/label/route.ts). PDF her zaman Ozon'dan canlı çekiliyor,
          biz saklamıyoruz — href'e dokunmuyoruz, tıklama SADECE yeni sekmede PDF'i açmanın
          YANINDA (onClick preventDefault yapmıyor) fatura+ASE'yi tetikliyor. */}
      {orderStatus === "awaiting_deliver" && (
        <div style={{ marginBottom: 6 }}>
          <a
            href={`/api/orders/${encodeURIComponent(postingNumber)}/label`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => invoiceRef.current?.triggerAutoInvoiceIfNeeded()}
            style={{
              display: "inline-block",
              textAlign: "center",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
              borderRadius: 8,
              padding: "10px 18px",
              border: "1px solid transparent",
              background: "var(--success)",
              color: "white",
            }}
          >
            Etiket Yazdır
          </a>
        </div>
      )}
      <InvoiceAndAseButton ref={invoiceRef} postingNumber={postingNumber} orderStatus={orderStatus} {...invoiceProps} />
    </div>
  );
}
