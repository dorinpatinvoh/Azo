-- Coordonnées du départ et de la destination d'une livraison (missions proches du coursier).
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupLat" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupLng" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "dropLat" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "dropLng" DOUBLE PRECISION;
