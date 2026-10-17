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
  speed?: number
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
