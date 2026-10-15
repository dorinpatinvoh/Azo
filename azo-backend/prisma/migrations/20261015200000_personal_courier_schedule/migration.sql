-- Coursier personnel : départ programmé et début de réservation.
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "bookedFrom" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
