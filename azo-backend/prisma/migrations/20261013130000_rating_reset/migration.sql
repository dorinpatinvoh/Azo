-- Règle de notation : remise à zéro des notes par un administrateur
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ratingResetAt" TIMESTAMP(3);
