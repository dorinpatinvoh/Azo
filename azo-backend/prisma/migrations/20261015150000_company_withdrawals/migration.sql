-- Retraits des gains de l'entreprise (écran « Finances » de l'administrateur)
CREATE TYPE "CompanyWithdrawalStatus" AS ENUM ('REQUESTED', 'PAID', 'CANCELLED');

CREATE TABLE "CompanyWithdrawal" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "status" "CompanyWithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "reference" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyWithdrawal_status_idx" ON "CompanyWithdrawal"("status");
