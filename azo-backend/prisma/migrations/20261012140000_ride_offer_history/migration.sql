-- Historique des propositions de Zem (PROJECT_SUMMARY/DEMANDE_BACKEND_FIN_PROPOSITION_ZEM.md, §3.1)
CREATE TABLE IF NOT EXISTS "RideOffer" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "RideOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RideOffer_driverId_status_idx" ON "RideOffer"("driverId", "status");
CREATE INDEX IF NOT EXISTS "RideOffer_rideId_driverId_idx" ON "RideOffer"("rideId", "driverId");

DO $$ BEGIN
  ALTER TABLE "RideOffer" ADD CONSTRAINT "RideOffer_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
