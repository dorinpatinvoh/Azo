-- =====================================================================
-- Migration : statut OFFERED, libellés d'adresses, champs offer, ratingCount
-- =====================================================================

-- 1. Ajouter la valeur OFFERED dans l'enum RideStatus
--    Doit s'exécuter HORS transaction (PostgreSQL l'impose pour ALTER TYPE … ADD VALUE).
--    Prisma migrate deploy gère ça via un script de migration dédié.
ALTER TYPE "RideStatus" ADD VALUE IF NOT EXISTS 'OFFERED' BEFORE 'MATCHED';

-- 2. Libellés d'adresses lisibles (optionnels)
ALTER TABLE "Ride"
  ADD COLUMN IF NOT EXISTS "originLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "destLabel"   TEXT;

-- 3. Champs pour la phase OFFERED
ALTER TABLE "Ride"
  ADD COLUMN IF NOT EXISTS "offeredAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "offerExpiresAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "declinedDriverIds" TEXT[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "matchedAt"         TIMESTAMP(3);

-- 4. ratingCount sur ProviderProfile
ALTER TABLE "ProviderProfile"
  ADD COLUMN IF NOT EXISTS "ratingCount" INTEGER NOT NULL DEFAULT 0;
