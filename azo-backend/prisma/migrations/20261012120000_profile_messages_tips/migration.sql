-- Migration : profil utilisateur (email, contact urgence, correction identité, changement téléphone),
--             messagerie persistée (RideMessage) et pourboire (RideTip, completedAt sur Ride).
-- Toutes les colonnes ajoutées sont nullables ou ont une valeur par défaut → aucune donnée existante touchée.

-- 1. Champs profil utilisateur
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emergencyContactName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emergencyContactPhone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "identityCorrectedAt" TIMESTAMP(3);

-- 2. Colonne kind sur Transaction (filtrage TIP vs RIDE dans les calculs)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "kind" TEXT;

-- 3. completedAt sur Ride
ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

-- 4. Index sur Ride (clientId, driverId) pour les conversations
CREATE INDEX IF NOT EXISTS "Ride_clientId_driverId_idx" ON "Ride"("clientId", "driverId");

-- 5. Demande de correction d'identité
CREATE TABLE IF NOT EXISTS "IdentityCorrectionRequest" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "firstName"    TEXT,
    "lastName"     TEXT,
    "gender"       "Gender",
    "reason"       TEXT NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById"  TEXT,
    "decidedAt"    TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdentityCorrectionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "IdentityCorrectionRequest_userId_status_idx"
    ON "IdentityCorrectionRequest"("userId", "status");
ALTER TABLE "IdentityCorrectionRequest"
    ADD CONSTRAINT "IdentityCorrectionRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Demande de changement de téléphone
CREATE TABLE IF NOT EXISTS "PhoneChangeRequest" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "newPhone"  TEXT NOT NULL,
    "codeHash"  TEXT NOT NULL,
    "attempts"  INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhoneChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PhoneChangeRequest_userId_createdAt_idx"
    ON "PhoneChangeRequest"("userId", "createdAt");
ALTER TABLE "PhoneChangeRequest"
    ADD CONSTRAINT "PhoneChangeRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Journal d'audit des changements de profil
CREATE TABLE IF NOT EXISTS "UserProfileChange" (
    "id"       TEXT NOT NULL,
    "userId"   TEXT NOT NULL,
    "field"    TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserProfileChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UserProfileChange_userId_at_idx"
    ON "UserProfileChange"("userId", "at");
ALTER TABLE "UserProfileChange"
    ADD CONSTRAINT "UserProfileChange_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. Messages de course persistés
CREATE TABLE IF NOT EXISTS "RideMessage" (
    "id"         TEXT NOT NULL,
    "rideId"     TEXT NOT NULL,
    "senderId"   TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "text"       TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt"     TIMESTAMP(3),
    CONSTRAINT "RideMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RideMessage_rideId_createdAt_idx"
    ON "RideMessage"("rideId", "createdAt");
CREATE INDEX IF NOT EXISTS "RideMessage_senderId_createdAt_idx"
    ON "RideMessage"("senderId", "createdAt");
ALTER TABLE "RideMessage"
    ADD CONSTRAINT "RideMessage_rideId_fkey"
    FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RideMessage"
    ADD CONSTRAINT "RideMessage_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. Pourboire
CREATE TABLE IF NOT EXISTS "RideTip" (
    "id"        TEXT NOT NULL,
    "rideId"    TEXT NOT NULL,
    "clientId"  TEXT NOT NULL,
    "driverId"  TEXT NOT NULL,
    "amount"    INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RideTip_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RideTip_rideId_key" ON "RideTip"("rideId");
CREATE INDEX IF NOT EXISTS "RideTip_driverId_createdAt_idx" ON "RideTip"("driverId", "createdAt");
CREATE INDEX IF NOT EXISTS "RideTip_clientId_createdAt_idx" ON "RideTip"("clientId", "createdAt");
ALTER TABLE "RideTip"
    ADD CONSTRAINT "RideTip_rideId_fkey"
    FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON UPDATE CASCADE;
ALTER TABLE "RideTip"
    ADD CONSTRAINT "RideTip_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "User"("id") ON UPDATE CASCADE;
ALTER TABLE "RideTip"
    ADD CONSTRAINT "RideTip_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "User"("id") ON UPDATE CASCADE;
