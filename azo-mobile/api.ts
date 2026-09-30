// Client HTTP de l'app AZƆ̀ : parle au backend NestJS.
//
// ⚠️ IMPORTANT : remplace l'adresse ci-dessous par l'IP de TON ordinateur sur le Wi-Fi
// (commande : hostname -I  -> prends la première, ex. 192.168.1.23).
// "localhost" ne marche PAS depuis un téléphone : pour lui, localhost = le téléphone lui-même.
//   - Téléphone réel (Expo Go)  : http://192.168.x.x:3000
//   - Émulateur Android         : http://10.0.2.2:3000
//   - Navigateur (expo web)     : http://localhost:3000

export const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://192.168.100.10:3000";
// Préfixe des routes de réservation.
//  - "" (vide)  : routes ajoutées dans NestJS  -> /places/..., /rides/...
//  - "/api"     : si tu utilises le projet Next.js séparé (alors change aussi API_URL / port)
const RIDES_PREFIX = "";

let authToken: string | null = null;
export const setToken = (t: string | null) => {
  authToken = t;
};

/** Erreur API : `message` lisible + `status` HTTP + `data` (corps brut, ex: data.code). */
export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: any) {
    super(message);
  }
}

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Une erreur est survenue.";

async function request<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...((options.headers as Record<string, string>) ?? {}),
      },
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // NestJS renvoie { message: "..." } ou { message: ["...", "..."] }
      const raw = data?.message ?? data?.error;
      const msg = Array.isArray(raw) ? raw.join("\n") : raw;
      throw new ApiError(msg || `Erreur ${res.status}`, res.status, data);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error)?.name === "AbortError")
      throw new ApiError("Le serveur met trop de temps à répondre.", 0);
    throw new ApiError("Impossible de joindre le serveur. Vérifie ta connexion.", 0);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string, opts?: { timeoutMs?: number }) => request<T>(path, opts),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
};

// --- Raccourcis pour les écrans ---
export const authApi = {
  requestOtp: (phone: string) => api.post<{ message: string }>("/auth/request-otp", { phone }),
  verifyOtp: async (phone: string, code: string) => {
    const r = await api.post<{ token: string; user: { id: string; role: string } }>(
      "/auth/verify-otp",
      { phone, code }
    );
    setToken(r.token); // toutes les requêtes suivantes sont authentifiées
    return r;
  },
};

export const walletApi = {
  get: () => api.get<{ balance: number; cashback: number }>("/wallet"),
};

// HomeScreen appelle userApi.me() : il n'existait pas dans ton fichier.
// ⚠️ Adapte la route ("/users/me") à celle de ton backend NestJS.
export const userApi = {
  me: () => api.get<{ fullName?: string }>("/users/me"),
};

/* ============ RÉSERVATION DE COURSES (API existante : /rides) ============ */

export type VehicleType = "ZEM" | "ZEM_ELECTRIC" | "CAR";
export type RideStatus = "PENDING" | "MATCHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type Place = { id?: string; title: string; subtitle?: string; latitude: number; longitude: number };

// ⚠️ N'ajoute AUCUN autre champ : le backend refuse les champs inconnus.
export type RideRequest = {
  originLat: number; originLng: number; destLat: number; destLng: number; vehicleType: VehicleType;
};
export type FareLine = { fromKm: number; toKm: number | null; km: number; perKm: number; amount: number };
// durationMin + breakdown : présents uniquement pour le Zem (prix calculé selon la distance)
export type Estimate = { distanceKm: number; etaMinutes: number; price: number; durationMin?: number; breakdown?: FareLine[] };
export type Ride = {
  id: string; status: RideStatus; vehicleType: VehicleType;
  originLat: number; originLng: number; destLat: number; destLng: number;
  price: number; driverId: string | null;
  driver?: { fullName: string; phone: string } | null;
};

const P = RIDES_PREFIX;

export const placesApi = {
  reverseGeocode: (latitude: number, longitude: number) =>
    api.post<{ address: string; fullAddress: string }>(`${P}/places/reverse-geocode`, { latitude, longitude }),
  search: async (q: string, near?: { latitude: number; longitude: number }) => {
    const qs = new URLSearchParams({ q });
    if (near) { qs.set("lat", String(near.latitude)); qs.set("lng", String(near.longitude)); }
    const r = await api.get<{ results: Place[] }>(`${P}/places/search?${qs.toString()}`);
    return r.results;
  },
};

export const rideApi = {
  estimate: (body: RideRequest) => api.post<Estimate>(`${P}/rides/estimate`, body),
  create: (body: RideRequest) => api.post<Ride>(`${P}/rides`, body),
  get: (id: string) => api.get<Ride>(`${P}/rides/${id}`, { timeoutMs: 8000 }),
};