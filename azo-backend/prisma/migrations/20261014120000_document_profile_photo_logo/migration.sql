-- Photo de profil (Zem, conducteur, coursier) et logo (agence) : nouvelles pièces du dossier prestataire
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'PROFILE_PHOTO';
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'LOGO';
