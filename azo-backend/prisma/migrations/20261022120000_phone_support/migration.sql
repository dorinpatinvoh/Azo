-- Prestataire (Speeder, coursier, livreur) dont le téléphone est fourni par une boutique partenaire : date de remise, boutique, et commission téléphone prélevée par course ou livraison
ALTER TABLE "ProviderProfile" ADD COLUMN "phoneSupportedAt" TIMESTAMP(3),
ADD COLUMN "phoneShop" TEXT;

ALTER TABLE "Ride" ADD COLUMN "phoneCommission" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Delivery" ADD COLUMN "phoneCommission" INTEGER NOT NULL DEFAULT 0;
