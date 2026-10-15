-- Deux niveaux d'agence en plus (PLATINE, ELITE) et nouveaux plafonds : PRO 30, SILVER 75, OR 100, DIAMANT 1 000, PLATINE 2 500, ELITE 5 000
-- Les nouvelles valeurs de l'enum ne sont pas utilisées dans ce fichier (aucune agence n'est encore PLATINE ou ELITE).
ALTER TYPE "AgencyPlan" ADD VALUE IF NOT EXISTS 'PLATINE';
ALTER TYPE "AgencyPlan" ADD VALUE IF NOT EXISTS 'ELITE';

ALTER TABLE "Agency" ALTER COLUMN "maxAccounts" SET DEFAULT 30;
UPDATE "Agency" SET "maxAccounts" = 30 WHERE "plan" = 'PRO';
UPDATE "Agency" SET "maxAccounts" = 75 WHERE "plan" = 'SILVER';
