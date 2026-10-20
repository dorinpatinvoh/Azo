-- Console web administrateur : mot de passe haché (administrateurs seulement)
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
