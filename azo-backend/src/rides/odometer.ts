export type OdometerPoint = {
  lat: number;
  lng: number;
  at: number;
  /** Précision GPS (m) annoncée avec ce point : sert à ne pas confondre le bruit du GPS avec un déplacement. */
  acc?: number;
  /** Mètres déjà comptés grâce à la vitesse du téléphone depuis ce point d'ancrage (évite de les compter deux fois). */
  cred?: number;
};

export type OdometerResult = {
  point: OdometerPoint;
  meters: number;
  accepted: boolean;
};

const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(a: Pick<OdometerPoint, "lat" | "lng">, b: Pick<OdometerPoint, "lat" | "lng">) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(b.lat - a.lat);
  const longitudeDelta = radians(b.lng - a.lng);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value))));
}

/** Au-delà de cette imprécision (m), le point est jeté : il fausserait la distance. */
export const MAX_ACCURACY_METERS = 30;
/** Un déplacement plus petit que cela n'est jamais compté (bruit du GPS à l'arrêt). */
export const MIN_STEP_METERS = 12;
/** En dessous de cette vitesse (m/s), le téléphone est considéré à l'arrêt. */
const STATIONARY_SPEED_MPS = 0.5;
/** Durée maximale (s) d'un intervalle compté à partir de la vitesse : au-delà, les données sont trop anciennes. */
const MAX_SPEED_INTERVAL_S = 5;

/**
 * Point de départ du compteur au moment où la course démarre : la dernière position connue du chauffeur, si elle est récente. Sans cela,
 * le compteur attendait une première position valide APRÈS le départ (précision du GPS, délai d'envoi) avant de pouvoir mesurer, et
 * démarrait en retard. Renvoie `null` si la position est inconnue ou trop ancienne : le premier relevé après le départ servira alors de point de départ.
 */
export const START_ANCHOR_MAX_AGE_MS = 60_000;
export function startAnchor(
  location: { lat?: number | null; lng?: number | null; at?: Date | null } | null | undefined,
  now: Date = new Date()
): { odoLat: number; odoLng: number; odoAt: Date } | null {
  if (!location || typeof location.lat !== "number" || typeof location.lng !== "number" || !location.at) return null;
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  if (now.getTime() - location.at.getTime() > START_ANCHOR_MAX_AGE_MS) return null;
  return { odoLat: location.lat, odoLng: location.lng, odoAt: now };
}

/** Mode strict (coursier personnel, livreur express) : vitesse (m/s) à partir de laquelle le téléphone est considéré en mouvement (≈ 5,4 km/h). */
const STRICT_MOVING_SPEED_MPS = 1.5;
/** Mode strict : en dessous de cette vitesse (m/s), le téléphone est pratiquement à l'arrêt. */
const STRICT_SLOW_SPEED_MPS = 1;

export type OdometerOptions = {
  /**
   * Mode strict : sans vitesse mesurée supérieure à 5,4 km/h, un déplacement n'est compté que s'il est franchement grand
   * (au moins 80 m à l'arrêt, 40 m si la vitesse est inconnue). Un GPS immobile qui dérive de 10 à 60 m ne fait plus monter le compteur ;
   * un vrai trajet lent n'est pas perdu : la distance depuis le point d'ancrage est comptée dès qu'elle dépasse ce seuil.
   */
  strict?: boolean;
};

/** Arrondi au millimètre. */
const mm = (meters: number) => Math.round(meters * 1000) / 1000;

/**
 * Cumule la distance réellement parcourue, en ignorant le bruit du GPS.
 *
 * Un GPS à l'arrêt « bouge » de 10 à 30 m d'un point à l'autre. Avant, tout écart supérieur à max(5 m, précision / 2) était compté :
 * la course accumulait des kilomètres sans que le Speeder ait bougé. Maintenant, on garde un point d'ancrage et on ne compte un
 * déplacement que s'il dépasse la zone d'incertitude des deux points (somme de leurs précisions, 12 m au minimum) ; et si la
 * vitesse mesurée par le téléphone indique l'arrêt, on exige un écart trois fois plus grand.
 */
export function odometerStep(
  previous: OdometerPoint | null,
  current: OdometerPoint,
  accuracy: number | undefined,
  speed?: number,
  options?: OdometerOptions
): OdometerResult | null {
  if (
    !Number.isFinite(current.lat) ||
    !Number.isFinite(current.lng) ||
    Math.abs(current.lat) > 90 ||
    Math.abs(current.lng) > 180 ||
    !Number.isFinite(current.at) ||
    typeof accuracy !== "number" ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > MAX_ACCURACY_METERS
  ) {
    return null;
  }

  const point: OdometerPoint = { lat: current.lat, lng: current.lng, at: current.at, acc: accuracy };
  if (!previous) return { point, meters: 0, accepted: true };

  const elapsedMs = current.at - previous.at;
  if (elapsedMs <= 0) return null;

  const distance = haversineMeters(previous, current);
  if (distance / (elapsedMs / 1000) > 40) return { point: previous, meters: 0, accepted: false };

  // Zone d'incertitude : les deux points peuvent être décalés de leur précision chacun
  const noise = Math.max(MIN_STEP_METERS, (previous.acc ?? accuracy) + accuracy);
  if (options?.strict) {
    const speedKnown = typeof speed === "number" && Number.isFinite(speed);
    const moving = speedKnown && (speed as number) >= STRICT_MOVING_SPEED_MPS;
    if (!moving) {
      const nearlyStopped = speedKnown && (speed as number) < STRICT_SLOW_SPEED_MPS;
      const required = nearlyStopped ? Math.min(150, Math.max(80, noise * 5)) : Math.min(100, Math.max(40, noise * 3));
      if (distance < required) return { point: previous, meters: 0, accepted: false };
      return { point, meters: mm(Math.max(0, distance - (previous.cred ?? 0))), accepted: true };
    }
    // En mouvement : on ne compte que par la position, jamais par la seule vitesse (une vitesse parasite de 2 m/s à l'arrêt ferait
    // monter le compteur). Le déplacement doit dépasser le bruit du GPS ET rester cohérent avec la vitesse mesurée : un « saut » de
    // quelques dizaines de mètres en une ou deux secondes alors que le téléphone annonce 2 m/s n'est pas un trajet. Un vrai trajet
    // n'est pas perdu : la distance depuis le point d'ancrage est comptée dès qu'elle dépasse le seuil.
    if (distance < noise || distance > (speed as number) * (elapsedMs / 1000) * 1.5 + 8) return { point: previous, meters: 0, accepted: false };
    return { point, meters: mm(Math.max(0, distance - (previous.cred ?? 0))), accepted: true };
  }
  const stationary = typeof speed === "number" && Number.isFinite(speed) && speed < STATIONARY_SPEED_MPS;
  if (distance < noise || (stationary && distance < noise * 3)) {
    // La position ne suffit pas à mesurer ce petit déplacement (le GPS bouge de 10 à 30 m à l'arrêt), mais la vitesse mesurée
    // par le téléphone (effet Doppler) est précise au dixième de m/s : si elle indique un vrai mouvement, on compte vitesse × temps,
    // sans jamais dépasser ce que la position permet. À l'arrêt (vitesse nulle ou inférieure à 0,5 m/s), rien n'est compté.
    if (!stationary && typeof speed === "number" && Number.isFinite(speed) && speed > 0) {
      const counted = mm(Math.min(speed * Math.min(elapsedMs / 1000, MAX_SPEED_INTERVAL_S), distance + noise));
      if (counted > 0) {
        return { point: { ...previous, at: current.at, cred: mm((previous.cred ?? 0) + counted) }, meters: counted, accepted: true };
      }
    }
    return { point: previous, meters: 0, accepted: false };
  }

  // Déplacement mesuré par la position : on retire ce qui a déjà été compté par la vitesse depuis l'ancrage
  return { point, meters: mm(Math.max(0, distance - (previous.cred ?? 0))), accepted: true };
}
