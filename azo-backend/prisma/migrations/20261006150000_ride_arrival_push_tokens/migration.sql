-- Adds the explicit driver-arrival step and stores a random pickup confirmation code.
-- The new enum value is not used by this migration's statements, so it is safe for
-- PostgreSQL deployments that execute migrations transactionally.
ALTER TYPE "RideStatus" ADD VALUE 'ARRIVED';

ALTER TABLE "Ride"
  ADD COLUMN "pickupCode" TEXT,
  ADD COLUMN "driverArrivedAt" TIMESTAMP(3);

-- Keep pre-existing rides readable after deploying this version. New rides receive
-- cryptographically random codes from the API; this only bootstraps old records.
UPDATE "Ride"
SET "pickupCode" = LPAD(FLOOR(RANDOM() * 10000)::INTEGER::TEXT, 4, '0')
WHERE "pickupCode" IS NULL;

CREATE TABLE "DevicePushToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DevicePushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DevicePushToken_token_key" ON "DevicePushToken"("token");
CREATE INDEX "DevicePushToken_userId_idx" ON "DevicePushToken"("userId");

ALTER TABLE "DevicePushToken"
  ADD CONSTRAINT "DevicePushToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
