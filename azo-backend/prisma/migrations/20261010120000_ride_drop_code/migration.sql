-- Code d'arrivée à destination : généré par le serveur quand le Zem le demande (course
-- IN_PROGRESS), lisible par le client seulement, saisi par le Zem pour terminer la course.
ALTER TABLE "Ride" ADD COLUMN "dropCode" TEXT;
