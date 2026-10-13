import type { LatLng } from "../components/OSMMapView";
import { ridesApi } from "./api";

export type DrivingRoute = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMinutes: number;
};

/**
 * Itinéraire d'une course en cours : on demande d'abord au SERVEUR (`GET /rides/:id/route`), qui
 * le met en cache quelques secondes et garde le dernier itinéraire valide si OSRM tombe. Un
 * téléphone qui appelle OSRM seul subit sa limite de débit, et c'est ce qui faisait disparaître
 * le tracé pendant un demi-tour. Repli sur OSRM direct si le serveur ne répond pas.
 */
export async function getRideRoute(
  rideId: string,
  origin: LatLng,
  destination: LatLng,
  signal?: AbortSignal
): Promise<DrivingRoute> {
  try {
    const route = await ridesApi.route(rideId);
    if (Array.isArray(route.coordinates) && route.coordinates.length >= 2) {
      return {
        coordinates: route.coordinates,
        distanceKm: route.distanceKm,
        durationMinutes: route.durationMinutes,
      };
    }
  } catch {
    // Serveur pas à jour, course plus éligible (ex. PENDING) ou panne : repli ci-dessous.
  }
  return getDrivingRoute(origin, destination, signal);
}

// Serveurs de calcul d'itinéraire compatibles OSRM, essayés dans l'ordre. Le serveur de démonstration
// d'OSRM limite le débit et tombe souvent : sans second serveur, une seule panne suffisait à
// afficher « itinéraire indisponible ». Le service FOSSGIS (OpenStreetMap Allemagne) répond à la même API.
const ROUTING_SERVERS = [
  "https://router.project-osrm.org/route/v1/driving",
  "https://routing.openstreetmap.de/routed-car/route/v1/driving",
];
const PER_SERVER_TIMEOUT_MS = 8000;

// Mémoire des itinéraires déjà calculés (extrémités arrondies à ~11 m) : l'écran de recherche de
// chauffeur réutilise l'itinéraire que l'écran de réservation vient de calculer, au lieu de
// rappeler le serveur public juste après (c'est ce second appel qui était refusé).
const routeCache = new Map<string, { at: number; route: DrivingRoute }>();
const CACHE_MS = 10 * 60 * 1000;
const keyOf = (a: LatLng, b: LatLng) =>
  [a.latitude, a.longitude, b.latitude, b.longitude].map((n) => n.toFixed(4)).join(",");

async function fetchRoute(server: string, origin: LatLng, destination: LatLng, signal?: AbortSignal): Promise<DrivingRoute> {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = `${server}/${coordinates}?overview=full&geometries=geojson&steps=false`;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), PER_SERVER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Routage HTTP ${response.status}`);
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
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Trajet d'une course, du départ du client à la destination (ligne pointillée de la carte du Zem).
 * Demandé d'abord au serveur (`?stage=trip`, mis en cache 10 min) ; repli sur OSRM si le serveur
 * ne le fournit pas encore.
 */
export async function getTripRoute(
  rideId: string,
  origin: LatLng,
  destination: LatLng,
  signal?: AbortSignal
): Promise<DrivingRoute> {
  try {
    const route = await ridesApi.route(rideId, "trip");
    if (Array.isArray(route.coordinates) && route.coordinates.length >= 2) {
      return { coordinates: route.coordinates, distanceKm: route.distanceKm, durationMinutes: route.durationMinutes };
    }
  } catch {
    // Serveur pas encore à jour : repli ci-dessous.
  }
  return getDrivingRoute(origin, destination, signal);
}

/**
 * Itinéraire routier OpenStreetMap (OSRM). La réservation exige une route routière valide afin
 * que l'affichage et le devis restent cohérents ; un échec n'est pas remplacé par une ligne
 * droite approximative. Essaie chaque serveur à tour de rôle, puis lève l'erreur du dernier.
 */
export async function getDrivingRoute(
  origin: LatLng,
  destination: LatLng,
  signal?: AbortSignal
): Promise<DrivingRoute> {
  const key = keyOf(origin, destination);
  const cached = routeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.route;

  let lastError: unknown = new Error("Aucun serveur d'itinéraire");
  for (const server of ROUTING_SERVERS) {
    if (signal?.aborted) break;
    try {
      const route = await fetchRoute(server, origin, destination, signal);
      routeCache.set(key, { at: Date.now(), route });
      return route;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
