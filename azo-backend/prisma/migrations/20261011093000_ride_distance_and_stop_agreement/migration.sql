ALTER TABLE "Ride"
  ADD COLUMN "traveledMeters" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "odoLat" DOUBLE PRECISION,
  ADD COLUMN "odoLng" DOUBLE PRECISION,
  ADD COLUMN "odoAt" TIMESTAMP(3),
  ADD COLUMN "stopRequestedBy" TEXT,
  ADD COLUMN "stopRequestedAt" TIMESTAMP(3),
  ADD COLUMN "stopRequestedPrice" INTEGER,
  ADD COLUMN "stopRequestedDistanceMeters" INTEGER,
  ADD COLUMN "finalPrice" INTEGER,
  ADD COLUMN "settledDistanceMeters" INTEGER,
  ADD COLUMN "priceMode" TEXT;

UPDATE "Ride"
SET "finalPrice" = "price",
    "settledDistanceMeters" = "traveledMeters",
    "priceMode" = 'FULL'
WHERE "status" = 'COMPLETED';

CREATE TABLE "RideTrackPoint" (
  "id" TEXT NOT NULL,
  "rideId" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "accuracy" INTEGER,
  "speed" DOUBLE PRECISION,
  "at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RideTrackPoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RideTrackPoint_rideId_at_idx" ON "RideTrackPoint"("rideId", "at");

ALTER TABLE "RideTrackPoint"
  ADD CONSTRAINT "RideTrackPoint_rideId_fkey"
  FOREIGN KEY ("rideId") REFERENCES "Ride"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
