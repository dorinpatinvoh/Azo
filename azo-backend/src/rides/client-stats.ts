export type ClientStats = { rating: number | null; ratedCount: number; rides: number };

const ZERO: ClientStats = { rating: null, ratedCount: 0, rides: 0 };

/**
 * Note moyenne (donnée par les chauffeurs), nombre de notes et nombre de courses terminées de chaque client : de quoi
 * décider d'accepter une demande en connaissance de cause. Renvoie null si le calcul échoue (le radar reste utilisable
 * sans ces chiffres) ; un client sans historique donne des zéros.
 */
export async function clientStatsFor(prisma: any, clientIds: string[]): Promise<Map<string, ClientStats> | null> {
  const ids = [...new Set(clientIds)];
  const stats = new Map<string, ClientStats>();
  if (ids.length === 0) return stats;
  try {
    const [done, rated] = await Promise.all([
      prisma.ride.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, status: "COMPLETED" }, _count: { _all: true } }),
      prisma.ride.groupBy({
        by: ["clientId"],
        where: { clientId: { in: ids }, clientRating: { not: null } },
        _count: { _all: true },
        _avg: { clientRating: true },
      }),
    ]);
    for (const id of ids) stats.set(id, { ...ZERO });
    for (const row of done as { clientId: string; _count: { _all: number } }[]) {
      stats.set(row.clientId, { ...(stats.get(row.clientId) ?? ZERO), rides: row._count._all });
    }
    for (const row of rated as { clientId: string; _count: { _all: number }; _avg: { clientRating: number | null } }[]) {
      stats.set(row.clientId, {
        ...(stats.get(row.clientId) ?? ZERO),
        ratedCount: row._count._all,
        rating: row._avg.clientRating === null ? null : Math.round(row._avg.clientRating * 10) / 10,
      });
    }
    return stats;
  } catch {
    return null;
  }
}
