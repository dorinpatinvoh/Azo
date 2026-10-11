CREATE TYPE "Gender" AS ENUM ('M', 'F');

ALTER TABLE "User"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "gender" "Gender",
  ADD COLUMN "npiHash" TEXT,
  ADD COLUMN "npiCipher" TEXT,
  ADD COLUMN "npiLast4" TEXT,
  ADD COLUMN "profileCompletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_npiHash_key" ON "User"("npiHash");

CREATE TABLE "NpiRegistrationAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NpiRegistrationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NpiRegistrationAttempt_userId_createdAt_idx"
  ON "NpiRegistrationAttempt"("userId", "createdAt");

ALTER TABLE "NpiRegistrationAttempt"
  ADD CONSTRAINT "NpiRegistrationAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NpiAccessAudit" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NpiAccessAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NpiAccessAudit_targetId_createdAt_idx"
  ON "NpiAccessAudit"("targetId", "createdAt");
