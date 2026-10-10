-- Nombre de saisies erronées sur un code de connexion (3 maximum, puis le code est annulé).
ALTER TABLE "OtpCode" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
