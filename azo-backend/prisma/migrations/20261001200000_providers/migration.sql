-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING_VALIDATION', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('DRIVER', 'AGENCY', 'ARTISAN', 'COURIER');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEED_INFO', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('CNI', 'SELFIE', 'PERMIS', 'CARTE_GRISE', 'ASSURANCE', 'VISITE_TECHNIQUE', 'PHOTO_VEHICULE', 'RCCM', 'IFU', 'STATUTS', 'DIPLOME', 'EXTRAIT_CASIER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "ProviderEventType" AS ENUM ('CREATED', 'UPDATED', 'SUBMITTED', 'DOCUMENT_ADDED', 'DOCUMENT_VALIDATED', 'DOCUMENT_REJECTED', 'REVIEW_STARTED', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REINSTATED', 'AGENCY_ATTACHED', 'AGENCY_DETACHED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "activationFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "feePaidAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProviderProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ProviderType" NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'DRAFT',
    "fullName" TEXT,
    "city" TEXT,
    "zones" TEXT[],
    "bio" TEXT,
    "experienceYears" INTEGER,
    "vehicleType" "VehicleType",
    "vehicleModel" TEXT,
    "plateNumber" TEXT,
    "categoryId" TEXT,
    "agencyName" TEXT,
    "plan" "AgencyPlan",
    "agencyId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectReason" TEXT,
    "suspensionReason" TEXT,
    "infoRequested" TEXT,
    "activatedAt" TIMESTAMP(3),
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jobsCompleted" INTEGER NOT NULL DEFAULT 0,
    "kycScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderDocument" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "url" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "reviewerNote" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "ProviderEventType" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_userId_key" ON "ProviderProfile"("userId");

-- CreateIndex
CREATE INDEX "ProviderProfile_status_type_idx" ON "ProviderProfile"("status", "type");

-- CreateIndex
CREATE INDEX "ProviderProfile_agencyId_idx" ON "ProviderProfile"("agencyId");

-- CreateIndex
CREATE INDEX "ProviderDocument_status_idx" ON "ProviderDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderDocument_providerId_kind_key" ON "ProviderDocument"("providerId", "kind");

-- CreateIndex
CREATE INDEX "ProviderEvent_providerId_createdAt_idx" ON "ProviderEvent"("providerId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderDocument" ADD CONSTRAINT "ProviderDocument_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEvent" ADD CONSTRAINT "ProviderEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Régularisation : les comptes déjà créés avec un rôle prestataire conservent leur
-- accès. Un dossier APPROVED leur est rattaché, avec kycScore = 0 : ils remontent dans
-- la console admin comme « à régulariser » (pièces à fournir a posteriori).
-- L'identifiant du dossier reprend celui de l'utilisateur : déterministe, et évite de
-- dépendre de l'extension pgcrypto (gen_random_uuid) sur la base cible.
INSERT INTO "ProviderProfile"
  ("id", "userId", "type", "status", "zones", "fullName", "activatedAt", "reviewedAt", "kycScore", "createdAt", "updatedAt")
SELECT
  u."id",
  u."id",
  u."role"::text::"ProviderType",
  'APPROVED'::"ProviderStatus",
  ARRAY[]::TEXT[],
  COALESCE(u."fullName", 'Compte prestataire existant'),
  u."createdAt",
  u."createdAt",
  0,
  u."createdAt",
  now()
FROM "User" u
WHERE u."role" IN ('DRIVER', 'AGENCY', 'ARTISAN');
