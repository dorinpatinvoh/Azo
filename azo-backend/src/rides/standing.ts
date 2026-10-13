import { ForbiddenException } from "@nestjs/common";

/**
 * Règle de notation, identique pour les clients (notés par les chauffeurs) et pour les chauffeurs (notés par les clients).
 *
 * - On regarde les notes des `windowDays` derniers jours (30 j) : un compte se rétablit tout seul quand les mauvaises notes
 *   vieillissent, il n'est jamais bloqué à vie.
 * - Tant qu'il y a moins de `minRatings` notes dans la fenêtre, aucune règle ne s'applique (pas de jugement sur 1 ou 2 avis).
 * - Moyenne sous `warnBelow` : AVERTISSEMENT affiché dans l'application.
 * - Moyenne sous `restrictBelow` : RESTRICTION — un client ne peut plus demander de course, un chauffeur ne peut plus en accepter.
 * - Un administrateur peut repartir de zéro (`User.ratingResetAt`) : les notes antérieures sont alors ignorées.
 */
export const RATING_POLICY = { windowDays: 30, minRatings: 5, warnBelow: 3.5, restrictBelow: 3.0 } as const;
export type RatingPolicy = typeof RATING_POLICY;

export type StandingLevel = "OK" | "WARNING" | "RESTRICTED";
export type Standing = {
  role: "CLIENT" | "DRIVER";
  rating: number | null;
  count: number;
  level: StandingLevel;
  windowDays: number;
  minRatings: number;
  warnBelow: number;
  restrictBelow: number;
};

export function levelFor(rating: number | null, count: number, policy: RatingPolicy = RATING_POLICY): StandingLevel {
  if (rating === null || count < policy.minRatings) return "OK";
  if (rating < policy.restrictBelow) return "RESTRICTED";
  if (rating < policy.warnBelow) return "WARNING";
  return "OK";
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function standing(
  prisma: any,
  userId: string,
  role: "CLIENT" | "DRIVER",
  now: Date,
  policy: RatingPolicy
): Promise<Standing> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ratingResetAt: true } });
  const windowStart = new Date(now.getTime() - policy.windowDays * DAY_MS);
  const since = user?.ratingResetAt && user.ratingResetAt > windowStart ? user.ratingResetAt : windowStart;

  const aggregate =
    role === "CLIENT"
      ? await prisma.ride.aggregate({
          where: { clientId: userId, clientRating: { not: null }, clientRatedAt: { gte: since } },
          _avg: { clientRating: true },
          _count: { _all: true },
        })
      : await prisma.ride.aggregate({
          where: { driverId: userId, rating: { not: null }, completedAt: { gte: since } },
          _avg: { rating: true },
          _count: { _all: true },
        });
  const avg = role === "CLIENT" ? aggregate._avg.clientRating : aggregate._avg.rating;
  const count: number = aggregate._count._all;
  const rating = avg === null || avg === undefined ? null : Math.round(avg * 10) / 10;
  return {
    role, rating, count, level: levelFor(rating, count, policy),
    windowDays: policy.windowDays, minRatings: policy.minRatings, warnBelow: policy.warnBelow, restrictBelow: policy.restrictBelow,
  };
}

export const clientStanding = (prisma: any, clientId: string, now: Date = new Date(), policy: RatingPolicy = RATING_POLICY) =>
  standing(prisma, clientId, "CLIENT", now, policy);
export const driverStanding = (prisma: any, driverId: string, now: Date = new Date(), policy: RatingPolicy = RATING_POLICY) =>
  standing(prisma, driverId, "DRIVER", now, policy);

const restrictedMessage = (s: Standing) =>
  `Ton compte est temporairement restreint : ta note récente est trop basse (${s.rating}/5 sur ${s.count} avis des ${s.windowDays} derniers jours). ` +
  "Elle se rétablit quand les anciens avis sortent de la période. Contacte l'assistance si tu penses qu'il y a une erreur.";

/**
 * Refuse (403, code stable) un client ou un chauffeur dont la note récente est sous le seuil de restriction.
 * Si le calcul échoue (base en panne), on laisse passer : une panne de statistique ne doit jamais bloquer une course.
 */
async function assertAllowed(compute: () => Promise<Standing>, code: string) {
  let result: Standing | null = null;
  try {
    result = await compute();
  } catch {
    return;
  }
  if (result.level === "RESTRICTED") throw new ForbiddenException({ code, message: restrictedMessage(result) });
}

export const assertClientAllowed = (prisma: any, clientId: string) =>
  assertAllowed(() => clientStanding(prisma, clientId), "CLIENT_RATING_TOO_LOW");
export const assertDriverAllowed = (prisma: any, driverId: string) =>
  assertAllowed(() => driverStanding(prisma, driverId), "DRIVER_RATING_TOO_LOW");
