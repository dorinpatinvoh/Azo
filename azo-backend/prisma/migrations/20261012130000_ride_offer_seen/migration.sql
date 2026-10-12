-- Popup de proposition du Zem (PROJECT_SUMMARY/DEMANDE_BACKEND_POPUP_PROPOSITION_ZEM.md, §4.7)
-- Quand le client a ouvert la popup : le Zem peut alors afficher « Le client regarde ton profil ».
ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "offerSeenAt" TIMESTAMP(3);
