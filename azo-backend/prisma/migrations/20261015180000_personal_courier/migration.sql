-- Coursier personnel : réservation d'un coursier (véhicule + durée) pour une course.
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'EXPRESS';
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "vehicleType" "VehicleType";
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "bookingHours" INTEGER;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "bookedUntil" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "distanceKm" DOUBLE PRECISION;
