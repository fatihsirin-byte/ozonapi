-- CreateTable
CREATE TABLE "ExcludedOfferId" (
    "offerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExcludedOfferId_pkey" PRIMARY KEY ("offerId")
);
