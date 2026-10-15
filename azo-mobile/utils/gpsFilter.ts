import { distanceKm, type LatLng } from "./geo";

/** Un point GPS brut tel que le donne expo-location. */
export type RawFix = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  timestamp: number;
};

export type FilterState = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

const M = 1000;
// Au-delà, le point vient d'un relais téléphonique / Wi-Fi : trop vague pour un Speeder sur la route.
const MAX_ACCURACY_M = 60;
// Un deux-roues ne fait pas plus de 40 m/s (144 km/h) : au-delà, c'est un saut GPS.
const MAX_SPEED_MS = 40;
// Après ce délai sans bon point, on accepte un point moins précis plutôt que de figer la carte.
const STALE_MS = 12000;

/**
 * Nettoie le flux GPS avant affichage et envoi au client :
 *  - rejette les points trop imprécis ou qui « sautent » (vitesse impossible) ;
 *  - à l'arrêt, garde le point précédent (le curseur ne tremble plus) ;
 *  - en mouvement, lisse légèrement les points peu précis.
 * Retourne le nouvel état, ou `null` si le point est ignoré.
 */
export function filterFix(prev: FilterState | null, fix: RawFix): FilterState | null {
  const accuracy = typeof fix.accuracy === "number" && fix.accuracy >= 0 ? fix.accuracy : 30;
  const next: FilterState = { latitude: fix.latitude, longitude: fix.longitude, accuracy, timestamp: fix.timestamp };
  if (!prev) return next;

  const dtMs = Math.max(1, fix.timestamp - prev.timestamp);
  const meters = distanceKm(prev, next) * M;
  const stale = dtMs > STALE_MS;

  if (accuracy > MAX_ACCURACY_M && !stale && accuracy >= prev.accuracy) return null;
  if (!stale && meters / (dtMs / 1000) > MAX_SPEED_MS && accuracy >= prev.accuracy / 2) return null;

  const speed = typeof fix.speed === "number" && fix.speed >= 0 ? fix.speed : undefined;
  const stationary = (speed !== undefined && speed < 0.8) || (speed === undefined && meters < Math.max(4, accuracy * 0.5));
  if (stationary && meters < Math.max(5, accuracy)) {
    // Arrêt : on garde la position, on retient seulement la meilleure précision connue.
    return { ...prev, accuracy: Math.min(prev.accuracy, accuracy), timestamp: fix.timestamp };
  }

  if (accuracy <= 10) return next;
  // Lissage : plus le point est vague, plus on se fie à la position précédente.
  const k = accuracy <= 20 ? 0.75 : 0.5;
  return {
    latitude: prev.latitude + (next.latitude - prev.latitude) * k,
    longitude: prev.longitude + (next.longitude - prev.longitude) * k,
    accuracy,
    timestamp: fix.timestamp,
  };
}

/**
 * Accroche un point au tracé de la route s'il en est proche (`maxMeters`), pour que le curseur
 * suive la chaussée au lieu de flotter à côté. Hors tracé, le point est rendu tel quel.
 */
export function snapToPolyline(point: LatLng, line: LatLng[], maxMeters = 25): LatLng {
  if (line.length < 2) return point;
  const cosLat = Math.cos((point.latitude * Math.PI) / 180);
  const toXY = (p: LatLng) => ({ x: (p.longitude - point.longitude) * cosLat * 111320, y: (p.latitude - point.latitude) * 110540 });
  let best: { d: number; lat: number; lng: number } | null = null;
  let prev = toXY(line[0]);
  for (let i = 1; i < line.length; i++) {
    const cur = toXY(line[i]);
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const len2 = dx * dx + dy * dy;
    // Projection de l'origine (le point) sur le segment [prev, cur]
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(prev.x * dx + prev.y * dy) / len2));
    const px = prev.x + t * dx;
    const py = prev.y + t * dy;
    const d = Math.hypot(px, py);
    if (!best || d < best.d) {
      best = {
        d,
        lat: line[i - 1].latitude + (line[i].latitude - line[i - 1].latitude) * t,
        lng: line[i - 1].longitude + (line[i].longitude - line[i - 1].longitude) * t,
      };
    }
    prev = cur;
  }
  return best && best.d <= maxMeters ? { latitude: best.lat, longitude: best.lng } : point;
}
