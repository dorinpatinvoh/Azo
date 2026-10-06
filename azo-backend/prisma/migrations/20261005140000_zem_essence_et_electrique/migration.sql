-- Migration : la filière Zem est dissociée de la filière Voiture.
--
--   * `VehicleType` gagne ZEM_ESSENCE et ZEM_ELECTRIC (moto-taxi à essence / électrique).
--   * GAZELLE / KOALA / LEOPARD ne désignent plus que des VOITURES (gammes de course).
--
-- Technique : le type est reconstruit (RENAME + CREATE + conversion des colonnes) plutôt
-- que modifié par `ALTER TYPE ... ADD VALUE` : PostgreSQL interdit d'utiliser une valeur
-- d'enum ajoutée dans la même transaction, ce qui empêcherait la conversion des données
-- ci-dessous.
--
-- Conversion des données
-- ----------------------
-- Jusqu'ici « GAZELLE » désignait le moto-taxi (Zem) : toutes les courses et tous les
-- dossiers DRIVER enregistrés avec cette valeur basculent donc sur ZEM_ESSENCE, qui est
-- le même véhicule avec le même tarif (800 F + 200 F/km puis 150 F/km). Sans cette
-- conversion, une course passée en moto serait relue comme une course en voiture.
--
-- La filière COURSIER (livraison) n'est pas touchée : ses choix de véhicule restent
-- inchangés dans l'immédiat (harmonisation « moto essence / moto électrique » prévue
-- séparément, elle toucherait les dossiers existants).

-- ---------------------------------------------------------------- VehicleType
ALTER TYPE "VehicleType" RENAME TO "VehicleType_old";

CREATE TYPE "VehicleType" AS ENUM ('ZEM_ESSENCE', 'ZEM_ELECTRIC', 'GAZELLE', 'KOALA', 'LEOPARD');

ALTER TABLE "Ride"
  ALTER COLUMN "vehicleType" TYPE "VehicleType"
  USING ("vehicleType"::text::"VehicleType");

ALTER TABLE "ProviderProfile"
  ALTER COLUMN "vehicleType" TYPE "VehicleType"
  USING ("vehicleType"::text::"VehicleType");

-- ------------------------------------------------- Rides : GAZELLE (moto) → Zem
UPDATE "Ride"
SET "vehicleType" = 'ZEM_ESSENCE'
WHERE "vehicleType" = 'GAZELLE';

-- ------------------------------------ Dossiers prestataires conducteurs (Zem)
UPDATE "ProviderProfile"
SET "vehicleType" = 'ZEM_ESSENCE'
WHERE "vehicleType" = 'GAZELLE'
  AND "type" = 'DRIVER';

DROP TYPE "VehicleType_old";
