-- Rattrapage : la migration `init` crée le niveau d'agence « ARGENT », alors que le code et les bases déjà en service utilisent « SILVER ».
-- Cette migration passe AVANT celle du 13/10 (20261013100000, qui cherche « SILVER ») : sur une base neuve elle renomme ARGENT en SILVER ;
-- sur les bases déjà alignées (local, Render) « ARGENT » n'existe plus et elle ne fait rien.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AgencyPlan' AND e.enumlabel = 'ARGENT'
  ) THEN
    ALTER TYPE "AgencyPlan" RENAME VALUE 'ARGENT' TO 'SILVER';
  END IF;
END $$;
