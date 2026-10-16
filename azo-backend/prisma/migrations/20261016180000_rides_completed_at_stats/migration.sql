-- Rattrapage : l'heure de fin des courses, le compteur de courses et la note moyenne des prestataires n'étaient pas tenus à jour.
-- Idempotent : tout est recalculé à partir des courses et livraisons réelles.

-- 1. Courses terminées sans heure de fin (pourboire, chat après course, gains du jour) : on retient la date de la demande
UPDATE "Ride" SET "completedAt" = "createdAt" WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;

-- 2. Nombre de courses et livraisons terminées par prestataire
UPDATE "ProviderProfile" p SET "jobsCompleted" =
  (SELECT COUNT(*) FROM "Ride" r WHERE r."driverId" = p."userId" AND r."status" = 'COMPLETED') +
  (SELECT COUNT(*) FROM "Delivery" d WHERE d."courierId" = p."userId" AND d."status" = 'COMPLETED');

-- 3. Note moyenne et nombre de notes (les notes antérieures à une remise à zéro par un administrateur restent ignorées)
UPDATE "ProviderProfile" p SET "ratingCount" = x.n, "rating" = ROUND(x.avg::numeric, 1)
FROM (
  SELECT r."driverId", COUNT(r."rating")::int AS n, AVG(r."rating") AS avg
  FROM "Ride" r JOIN "User" u ON u."id" = r."driverId"
  WHERE r."rating" IS NOT NULL AND (u."ratingResetAt" IS NULL OR r."createdAt" > u."ratingResetAt")
  GROUP BY r."driverId"
) x
WHERE x."driverId" = p."userId";
