-- Secure ride settlement: the driver reports drop-off, then the client confirms.
CREATE TABLE "RideSettlement" (
  "id" TEXT NOT NULL,
  "rideId" TEXT NOT NULL,
  "dropoffAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmationDeadline" TIMESTAMP(3) NOT NULL,
  "clientConfirmedAt" TIMESTAMP(3),
  "problemReportedAt" TIMESTAMP(3),
  "problemReason" TEXT,
  CONSTRAINT "RideSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RideSettlement_rideId_key" UNIQUE ("rideId"),
  CONSTRAINT "RideSettlement_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RideSettlement_confirmationDeadline_idx" ON "RideSettlement"("confirmationDeadline");
