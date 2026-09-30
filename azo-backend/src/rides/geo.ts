export const SERVICE_TYPES = ["transport", "zem", "livraison"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export interface LatLng { lat: number; lng: number }

const toRad = (d: number) => (d * Math.PI) / 180;

/** Distance à vol d'oiseau (km) */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const lerp = (a: LatLng, b: LatLng, t: number): LatLng => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
});

/** Tarifs FCFA — le Zem est nettement moins cher que la Voiture. À ajuster. */
export const TARIFFS: Record<
  ServiceType,
  { base: number; perKm: number; perMin: number; min: number; speedKmh: number }
> = {
  transport: { base: 500, perKm: 250, perMin: 20, min: 1000, speedKmh: 25 },
  zem: { base: 200, perKm: 120, perMin: 10, min: 500, speedKmh: 32 },
  livraison: { base: 400, perKm: 180, perMin: 15, min: 800, speedKmh: 28 },
};

const ROAD_FACTOR = 1.3; // vol d'oiseau -> distance routière approximative

export function computeEstimate(origin: LatLng, destination: LatLng, serviceType: ServiceType) {
  const t = TARIFFS[serviceType];
  const distanceKm = Math.max(0.1, Math.round(haversineKm(origin, destination) * ROAD_FACTOR * 10) / 10);
  const durationMin = Math.max(1, Math.round((distanceKm / t.speedKmh) * 60));
  const raw = t.base + distanceKm * t.perKm + durationMin * t.perMin;
  const price = Math.max(t.min, Math.round(raw / 50) * 50); // arrondi à 50 FCFA
  return { distanceKm, durationMin, price, currency: "FCFA" as const };
}
