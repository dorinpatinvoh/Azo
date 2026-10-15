-- Type de compte choisi à l'inscription : seule l'inscription « AGENCY » permet d'ouvrir un dossier d'agence
ALTER TABLE "User" ADD COLUMN "signupKind" TEXT;
