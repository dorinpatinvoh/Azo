-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('CONFIRMED', 'PENDING', 'FAILED');

-- AlterTable: add status column with default CONFIRMED (retrocompatible)
ALTER TABLE "Transaction"
  ADD COLUMN "status" "TransactionStatus" NOT NULL DEFAULT 'CONFIRMED';
