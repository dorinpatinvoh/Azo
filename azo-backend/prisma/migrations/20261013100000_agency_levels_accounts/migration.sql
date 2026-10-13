-- Plafond de comptes des niveaux d'agence (grille validée le 04/10/2026) : PRO 10, SILVER 25, OR 100, DIAMANT 1 000
ALTER TABLE "Agency" ALTER COLUMN "maxAccounts" SET DEFAULT 10;
UPDATE "Agency" SET "maxAccounts" = 10 WHERE "plan" = 'PRO';
UPDATE "Agency" SET "maxAccounts" = 25 WHERE "plan" = 'SILVER';
UPDATE "Agency" SET "maxAccounts" = 100 WHERE "plan" = 'OR';
UPDATE "Agency" SET "maxAccounts" = 1000 WHERE "plan" = 'DIAMANT';
