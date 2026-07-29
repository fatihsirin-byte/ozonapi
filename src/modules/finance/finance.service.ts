import { prisma } from "../../db/prisma";
import { listTransactions } from "../../ozon/finance";

// Tek bir posting_number için komisyon, kargo ve diğer kesintileri çekip DB'ye kaydeder.
export async function syncTransactionsForPosting(postingNumber: string) {
  const { result } = await listTransactions({ postingNumber });

  for (const op of result.operations) {
    await prisma.financeTransaction.create({
      data: {
        postingNumber: op.posting.posting_number,
        operationType: op.operation_type,
        operationDate: new Date(op.operation_date),
        amount: op.amount,
        commissionAmount: op.sale_commission,
        deliveryCharge: op.delivery_charge,
        otherCharges: op.return_delivery_charge,
        rawPayload: op as unknown as object,
      },
    });
  }

  return result.operations;
}
