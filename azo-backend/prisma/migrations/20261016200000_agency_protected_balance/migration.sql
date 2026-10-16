-- L'argent qu'un chauffeur avait avant son rattachement à une agence lui appartient : l'agence ne peut retirer que la part gagnée ou rechargée depuis.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agencyJoinedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "agencyProtectedBalance" INTEGER NOT NULL DEFAULT 0;

-- Rattrapage des chauffeurs déjà rattachés : solde au moment du rattachement = crédits − débits d'avant cette date
-- (borné entre 0 et le solde actuel : on protège au plus ce que le chauffeur possède encore).
UPDATE "User" u SET "agencyJoinedAt" = e."at",
  "agencyProtectedBalance" = GREATEST(0, LEAST(w."balance", t."bal"::int))
FROM (
  SELECT p."userId", MAX(ev."createdAt") AS "at"
  FROM "ProviderEvent" ev JOIN "ProviderProfile" p ON p."id" = ev."providerId"
  WHERE ev."type" = 'AGENCY_ATTACHED'
  GROUP BY p."userId"
) e,
"Wallet" w,
LATERAL (
  SELECT COALESCE(SUM(CASE WHEN tr."type" = 'CREDIT' THEN tr."amount" ELSE -tr."amount" END), 0) AS bal
  FROM "Transaction" tr WHERE tr."walletId" = w."id" AND tr."createdAt" < e."at"
) t
WHERE e."userId" = u."id" AND w."userId" = u."id" AND u."agencyId" IS NOT NULL AND u."role" <> 'AGENCY';
