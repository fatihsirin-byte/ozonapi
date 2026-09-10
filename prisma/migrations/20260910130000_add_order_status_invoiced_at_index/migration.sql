-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_parasutInvoicedAt_idx" ON "Order"("parasutInvoicedAt");
