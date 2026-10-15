-- Rattrapage : la migration `init` crée VehicleType = (ZEM, ZEM_ELECTRIC, CAR), alors que le code et les bases déjà en service
-- utilisent (ZEM_ESSENCE, ZEM_ELECTRIC, GAZELLE, KOALA, LEOPARD). Sans cette migration, une base neuve construite uniquement par les
-- migrations refuse « ZEM_ESSENCE », « KOALA »… (impossible de créer un Spider ou une voiture).
-- Elle passe AVANT les migrations suivantes. Sur les bases déjà alignées (local, Render) elle ne fait rien : les anciennes valeurs
-- n'existent plus et les nouvelles sont déjà là (ADD VALUE IF NOT EXISTS). Les anciennes courses gardent leur sens :
-- ZEM devient ZEM_ESSENCE et CAR devient KOALA (même correspondance que `legacyVehicleMapping`).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'VehicleType' AND e.enumlabel = 'ZEM'
  ) THEN
    ALTER TYPE "VehicleType" RENAME VALUE 'ZEM' TO 'ZEM_ESSENCE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'VehicleType' AND e.enumlabel = 'CAR'
  ) THEN
    ALTER TYPE "VehicleType" RENAME VALUE 'CAR' TO 'KOALA';
  END IF;
END $$;

ALTER TYPE "VehicleType" ADD VALUE IF NOT EXISTS 'GAZELLE';
ALTER TYPE "VehicleType" ADD VALUE IF NOT EXISTS 'LEOPARD';
