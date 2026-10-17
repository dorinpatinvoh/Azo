-- Livraisons : le compteur de kilomètres utilise la vitesse du téléphone, comme pour une course simple
ALTER TABLE "Delivery" ADD COLUMN "odoCred" DOUBLE PRECISION NOT NULL DEFAULT 0;
