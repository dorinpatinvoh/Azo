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

/** Distance parcourue, au plus près : « 742,3 m » sous 1 km, « 1,254 km » au-delà (le compteur suit chaque déplacement). */
export const fmtTraveled = (km: number) =>
  km < 1
    ? `${(km * 1000).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`
    : `${km.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km`;

export const fmtKm = (km: number) =>
  `${km.toLocaleString("fr-FR", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;

/** "à 1,2 km" si on connaît la position du chauffeur, sinon chaîne vide. */
export const fmtDistance = (from: LatLng | null, to: LatLng) =>
  from ? `à ${fmtKm(distanceKm(from, to))}` : "";
