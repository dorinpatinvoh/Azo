/**
 * Radar des demandes AZƆ̀ — logique **pure** (aucune dépendance NestJS ni Prisma),
 * donc directement testable et réutilisable.
 *
 * Le radar répond à trois questions :
 *   1. **quelles demandes sont encore valables ?** une demande en attente depuis plus de
 *      `pendingExpiryMinutes` est expirée : elle disparaît du radar et est annulée
 *      (voir `RidesService`) ;
 *   2. **lesquelles sont proches du chauffeur ?** quand l'application transmet sa position
 *      (`GET /rides/pending?lat=…&lng=…`), les demandes au-delà du rayon configuré
 *      (`searchRadiusKm`, 0 = pas de limite) sont écartées, et les autres sont classées de
 *      la plus proche à la plus lointaine ;
 *   3. **depuis / pendant combien de temps ?** chaque demande porte son âge et le temps
 *      restant avant expiration, affichés tels quels dans l'application.
 *
 * Sans position (GPS refusé, téléphone sans GPS), le radar reste utilisable : aucune
 * demande n'est écartée et le classement se fait du plus ancien au plus récent.
 */

export type RadarSettings = {
  /** Correspondance exacte des véhicules (Zem essence ≠ Zem électrique, etc.). */
  strictVehicleMatch: boolean;
  /** Rayon de recherche en km autour du chauffeur — `0` = aucune limite. */
  searchRadiusKm: number;
  /** Délai au bout duquel une demande sans chauffeur expire (minutes). */
  pendingExpiryMinutes: number;
  /** Nombre maximal de chauffeurs prévenus à la publication d'une demande. */
  driverNotificationMax: number;
};

export type LatLng = { latitude: number; longitude: number };

/** Champs minimaux d'une course pour passer dans le radar. */
export type RadarableRide = {
  createdAt: Date | string;
  originLat: number;
  originLng: number;
};

export type RadarRide<T> = T & {
  /** Distance chauffeur → point de départ (km, 1 décimale) ; `null` sans position connue. */
  distanceKm: number | null;
  /** Âge de la demande en minutes. */
  ageMinutes: number;
  /** Minutes restantes avant expiration (0 = expire maintenant). */
  expiresInMinutes: number;
};

const toMs = (value: Date | string | number): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

/** Âge d'une demande, en minutes (valeur décimale, jamais négative). */
export function rideAgeMinutes(createdAt: Date | string | number, now: number = Date.now()): number {
  return Math.max(0, (now - toMs(createdAt)) / 60000);
}

/** Une demande est expirée dès qu'elle atteint `expiryMinutes` sans avoir été prise. */
export function isRideExpired(
  createdAt: Date | string | number,
  expiryMinutes: number,
  now: number = Date.now()
): boolean {
  return rideAgeMinutes(createdAt, now) >= expiryMinutes;
}

const toRad = (degrees: number) => (degrees * Math.PI) / 180;

/** Distance à vol d'oiseau en km (Haversine) — même formule que le calcul du prix. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export type BuildRadarOptions = {
  /** Horodatage de référence (injectable pour les tests). */
  now?: number;
  expiryMinutes: number;
  radiusKm: number;
  /** Position du chauffeur, si connue. */
  driver?: LatLng | null;
};

export type RadarResult<T> = {
  /** Demandes encore valables, classées pour l'affichage. */
  rides: RadarRide<T>[];
  /** Demandes expirées à annuler (aucun chauffeur ne les a prises). */
  expired: T[];
};

/**
 * Prépare les demandes affichées par le radar d'un chauffeur.
 *
 * `rides` doit déjà être filtré sur le véhicule du chauffeur
 * (`PricingService.rideVisibleFor`) : cette fonction ne s'occupe que du temps et de la
 * distance.
 */
export function buildRadar<T extends RadarableRide>(
  rides: T[],
  options: BuildRadarOptions
): RadarResult<T> {
  const now = options.now ?? Date.now();
  const expiryMinutes = Math.max(1, options.expiryMinutes);
  const driver = options.driver ?? null;
  const radiusKm = Math.max(0, options.radiusKm);

  const expired: T[] = [];
  const fresh: RadarRide<T>[] = [];

  for (const ride of rides) {
    const ageMinutes = rideAgeMinutes(ride.createdAt, now);
    if (ageMinutes >= expiryMinutes) {
      expired.push(ride);
      continue;
    }

    const distanceKm = driver
      ? Math.round(haversineKm(driver, { latitude: ride.originLat, longitude: ride.originLng }) * 10) / 10
      : null;
    // Rayon de recherche : seulement quand la position est connue et la limite active.
    if (driver && radiusKm > 0 && (distanceKm ?? 0) > radiusKm) continue;

    fresh.push({
      ...ride,
      distanceKm,
      ageMinutes: Math.round(ageMinutes * 10) / 10,
      expiresInMinutes: Math.max(0, Math.ceil(expiryMinutes - ageMinutes)),
    });
  }

  const createdAsc = (a: RadarRide<T>, b: RadarRide<T>) => toMs(a.createdAt) - toMs(b.createdAt);
  fresh.sort((a, b) => {
    if (a.distanceKm == null || b.distanceKm == null) return createdAsc(a, b);
    return a.distanceKm === b.distanceKm ? createdAsc(a, b) : a.distanceKm - b.distanceKm;
  });

  return { rides: fresh, expired };
}

/** Résumé lisible d'un rayon de recherche, pour les messages de l'interface. */
export function describeRadius(radiusKm: number): string {
  return radiusKm > 0 ? `dans un rayon de ${radiusKm} km` : "autour de toi";
}
