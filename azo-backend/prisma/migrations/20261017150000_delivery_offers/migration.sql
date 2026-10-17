-- Livraisons : le coursier ou livreur se propose, le client valide (comme pour une course simple), et le coursier suit le client
ALTER TABLE "Delivery"
  ADD COLUMN "offeredAt" TIMESTAMP(3),
  ADD COLUMN "offerExpiresAt" TIMESTAMP(3),
  ADD COLUMN "offerSeenAt" TIMESTAMP(3),
  ADD COLUMN "declinedCourierIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "clientLat" DOUBLE PRECISION,
  ADD COLUMN "clientLng" DOUBLE PRECISION,
  ADD COLUMN "clientLocatedAt" TIMESTAMP(3);
