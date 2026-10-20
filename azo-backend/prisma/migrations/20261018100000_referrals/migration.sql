-- Parrainage : parrains créés par l'administrateur, et prestataires qu'ils ont recrutés
CREATE TABLE "Referrer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referrer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Referrer_userId_key" ON "Referrer"("userId");
CREATE UNIQUE INDEX "Referrer_code_key" ON "Referrer"("code");

ALTER TABLE "User" ADD COLUMN "referrerId" TEXT,
ADD COLUMN "referredAt" TIMESTAMP(3);

CREATE INDEX "User_referrerId_idx" ON "User"("referrerId");

ALTER TABLE "Referrer" ADD CONSTRAINT "Referrer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
