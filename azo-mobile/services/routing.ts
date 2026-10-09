import type { LatLng } from "../components/OSMMapView";

export type DrivingRoute = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMinutes: number;
};

/**
 * Itinéraire routier OpenStreetMap via le service public OSRM.
 * Cette API gratuite est utilisée en best effort pour le MVP; l'écran conserve une
 * estimation directe si le service est indisponible ou ne couvre pas la zone.
 */
export async function getDrivingRoute(
  origin: LatLng,
  destination: LatLng,
  signal?: AbortSignal
): Promise<DrivingRoute> {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);

  const result = await response.json();
  const route = result?.routes?.[0];
  const rawCoordinates: unknown = route?.geometry?.coordinates;
  if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
    throw new Error("Aucun itinéraire routier disponible");
  }

  const points = rawCoordinates
    .map((point: unknown) => {
      if (!Array.isArray(point) || typeof point[0] !== "number" || typeof point[1] !== "number") return null;
      return { longitude: point[0], latitude: point[1] };
    })
    .filter((point): point is LatLng => !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude));

  if (points.length < 2 || typeof route.duration !== "number" || typeof route.distance !== "number") {
    throw new Error("Réponse d'itinéraire invalide");
  }

  return {
    coordinates: points,
    distanceKm: route.distance / 1000,
    durationMinutes: Math.max(1, Math.ceil(route.duration / 60)),
  };
}
