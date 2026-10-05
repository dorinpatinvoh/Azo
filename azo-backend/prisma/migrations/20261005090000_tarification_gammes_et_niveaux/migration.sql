-- Migration : gammes de véhicules GAZELLE / KOALA / LEOPARD et niveaux d'agence
-- PRO / SILVER / OR / DIAMANT (spécification métier AZƆ̀ — Tarifs et profils).
--
-- 1) VehicleType : ZEM et ZEM_ELECTRIC -> GAZELLE, CAR -> KOALA.
--    LEOPARD est ajouté (haut de gamme, aucun ancien véhicule à convertir).
-- 2) AgencyPlan : ARGENT -> SILVER. Les valeurs de la grille (frais d'activation,
--    commission, frais de retrait, plafond de comptes) sont réappliquées depuis la
--    configuration tarifaire, notamment le plafond PRO qui passe de 10 à 25 comptes.

-- ---------------------------------------------------------------- VehicleType

ALTER TYPE "VehicleType" RENAME TO "VehicleType_old";

CREATE TYPE "VehicleType" AS ENUM ('GAZELLE', 'KOALA', 'LEOPARD');

ALTER TABLE "Ride"
  ALTER COLUMN "vehicleType" TYPE "VehicleType"
  USING (
    CASE "vehicleType"::text
      WHEN 'ZEM' THEN 'GAZELLE'
      WHEN 'ZEM_ELECTRIC' THEN 'GAZELLE'
      WHEN 'CAR' THEN 'KOALA'
      ELSE 'GAZELLE'
    END
  )::"VehicleType";

ALTER TABLE "ProviderProfile"
  ALTER COLUMN "vehicleType" TYPE "VehicleType"
  USING (
    CASE "vehicleType"::text
      WHEN 'ZEM' THEN 'GAZELLE'
      WHEN 'ZEM_ELECTRIC' THEN 'GAZELLE'
      WHEN 'CAR' THEN 'KOALA'
      ELSE NULL
    END
  )::"VehicleType";

DROP TYPE "VehicleType_old";

-- ---------------------------------------------------------------- AgencyPlan

ALTER TYPE "AgencyPlan" RENAME TO "AgencyPlan_old";

CREATE TYPE "AgencyPlan" AS ENUM ('PRO', 'SILVER', 'OR', 'DIAMANT');

ALTER TABLE "Agency"
  ALTER COLUMN "plan" DROP DEFAULT,
  ALTER COLUMN "plan" TYPE "AgencyPlan"
    USING (
      CASE "plan"::text
        WHEN 'ARGENT' THEN 'SILVER'
        ELSE "plan"::text
      END
    )::"AgencyPlan",
  ALTER COLUMN "plan" SET DEFAULT 'PRO';

ALTER TABLE "ProviderProfile"
  ALTER COLUMN "plan" TYPE "AgencyPlan"
  USING (
    CASE "plan"::text
      WHEN 'ARGENT' THEN 'SILVER'
      ELSE "plan"::text
    END
  )::"AgencyPlan";

DROP TYPE "AgencyPlan_old";

-- ------------------------------------------- Grille officielle (config tarifaire)

-- Valeurs par défaut alignées sur le niveau PRO de la grille
ALTER TABLE "Agency"
  ALTER COLUMN "commissionRate" SET DEFAULT 0.03,
  ALTER COLUMN "maxAccounts" SET DEFAULT 25,
  ALTER COLUMN "activationFee" SET DEFAULT 100000;

UPDATE "Agency" SET
  "activationFee"  = CASE "plan"
    WHEN 'PRO'     THEN 100000
    WHEN 'SILVER'  THEN 215500
    WHEN 'OR'      THEN 450500
    WHEN 'DIAMANT' THEN 600500
  END,
  "commissionRate" = CASE "plan"
    WHEN 'PRO'     THEN 0.03
    WHEN 'SILVER'  THEN 0.025
    WHEN 'OR'      THEN 0.02
    WHEN 'DIAMANT' THEN 0.01
  END,
  "maxAccounts"    = CASE "plan"
    WHEN 'PRO'     THEN 25
    WHEN 'SILVER'  THEN 50
    WHEN 'OR'      THEN 100
    WHEN 'DIAMANT' THEN 1000
  END;
