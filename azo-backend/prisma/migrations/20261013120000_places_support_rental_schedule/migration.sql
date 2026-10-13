-- Adresses enregistrées, assistance (tickets), location en base, note du client, courses programmées
ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "clientRating" INTEGER;
ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "clientRatedAt" TIMESTAMP(3);
ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "scheduledReleasedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Ride_scheduledAt_idx" ON "Ride"("scheduledAt");

ALTER TABLE "RentalBooking" ADD COLUMN IF NOT EXISTS "vehicleId" TEXT;
ALTER TABLE "RentalBooking" ADD COLUMN IF NOT EXISTS "totalPrice" INTEGER;

CREATE TABLE IF NOT EXISTS "RentalVehicle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "pricePerDay" INTEGER NOT NULL,
    "price4h" INTEGER,
    "priceWeek" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RentalVehicle_pkey" PRIMARY KEY ("id")
);

-- Catalogue de départ (les deux véhicules qui étaient codés en dur)
INSERT INTO "RentalVehicle" ("id", "name", "seats", "pricePerDay")
SELECT 'corolla', 'Toyota Corolla Prestige', 4, 28000 WHERE NOT EXISTS (SELECT 1 FROM "RentalVehicle" WHERE "id" = 'corolla');
INSERT INTO "RentalVehicle" ("id", "name", "seats", "pricePerDay")
SELECT 'tucson', 'Hyundai Tucson SUV Confort', 5, 35000 WHERE NOT EXISTS (SELECT 1 FROM "RentalVehicle" WHERE "id" = 'tucson');

CREATE TABLE IF NOT EXISTS "SavedPlace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedPlace_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SavedPlace_userId_kind_idx" ON "SavedPlace"("userId", "kind");

CREATE TABLE IF NOT EXISTS "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "rideId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupportTicket_userId_status_idx" ON "SupportTicket"("userId", "status");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_updatedAt_idx" ON "SupportTicket"("status", "updatedAt");

CREATE TABLE IF NOT EXISTS "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "SavedPlace" ADD CONSTRAINT "SavedPlace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
