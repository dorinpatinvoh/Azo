-- Arrêt anticipé accepté : le paiement attend le code d arrivée saisi par le Zem
ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "stopAcceptedAt" TIMESTAMP(3);
