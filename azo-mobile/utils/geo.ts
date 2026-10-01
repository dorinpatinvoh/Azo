// Petits calculs de distance côté app (le backend a le même à 2 endroits : geo.ts
// et rides.service.ts — à factoriser un jour dans un paquet partagé).

export type LatLng = { latitude: number; longitude: number };

const toRad = (d: number) => (d * Math.PI) / 180;

/** Distance à vol d'oiseau en km (formule de Haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const fmtKm = (km: number) =>
  `${km.toLocaleString("fr-FR", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;

/** "à 1,2 km" si on connaît la position du chauffeur, sinon chaîne vide. */
export const fmtDistance = (from: LatLng | null, to: LatLng) =>
  from ? `à ${fmtKm(distanceKm(from, to))}` : "";
