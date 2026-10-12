-- AlterTable: add i18n key fields to Notification
ALTER TABLE "Notification"
  ADD COLUMN "titleKey"  TEXT,
  ADD COLUMN "bodyKey"   TEXT,
  ADD COLUMN "params"    JSONB;

-- AlterTable: add i18n key fields to Transaction
ALTER TABLE "Transaction"
  ADD COLUMN "labelKey"    TEXT,
  ADD COLUMN "labelParams" JSONB;
