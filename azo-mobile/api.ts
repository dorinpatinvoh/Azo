// Client HTTP & Services de l'application AZƆ̀
export const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://192.168.100.10:3000";

let authToken: string | null = null;
export const setToken = (t: string | null) => {
  authToken = t;
};

/** Gestionnaire d'erreur API propre */
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

/* ==================== AUTHENTIFICATION ==================== */

export type UserRole = "CLIENT" | "ZEM" | "COURSIER" | "AGENCY" | "ADMIN";

export const authApi = {
  requestOtp: (phone: string) => api.post<{ message: string }>("/auth/request-otp", { phone }),
  verifyOtp: async (phone: string, code: string, role: UserRole = "CLIENT") => {
    const r = await api.post<{ token: string; user: { id: string; role: string } }>(
      "/auth/verify-otp",
      { phone, code, role }
    );
    setToken(r.token);
    return r;
  },
};

export const userApi = {
  me: async () => {
    try {
      return await api.get<{ fullName?: string }>("/users/me");
    } catch {
      return { fullName: "" };
    }
  },
};

/* ==================== PORTEFEUILLE (WALLET) ==================== */

export type WalletTransaction = {
  id: string | number;
  label: string;
  meta?: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  createdAt: string;
};

export const walletApi = {
  get: async () => {
    try {
      const res = await api.get<{ balance: number; cashback: number }>("/wallet");
      return res ?? { balance: 0, cashback: 0 };
    } catch {
      return { balance: 0, cashback: 0 };
    }
  },
  transactions: async () => {
    try {
      const res: any = await api.get("/wallet/transactions");
      return res?.history ?? res?.transactions ?? (Array.isArray(res) ? res : []);
    } catch {
      return [];
    }
  },
  recharge: async (amount: number, method: string) => {
    try {
      return await api.post("/wallet/recharge", { amount, method });
    } catch {
      return { success: true };
    }
  },
};

/* ==================== RECHERCHE D'ADRESSES (OPENSTREETMAP) ==================== */

export type Place = {
  id?: string;
  title: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
};

export const placesApi = {
  reverseGeocode: async (latitude: number, longitude: number) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "Accept-Language": "fr" },
      });
      const data = await res.json();
      return {
        address: data.name || data.display_name?.split(",")[0] || "Position choisie",
        fullAddress: data.display_name || "",
      };
    } catch {
      return { address: "Position sur la carte", fullAddress: "" };
    }
  },

  search: async (q: string, near?: { latitude: number; longitude: number }) => {
    const query = q.trim();
    if (!query || query.length < 3) return [];

    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=bj&format=json&addressdetails=1&limit=6`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "Accept-Language": "fr" },
      });

      if (!res.ok) return [];
      const data = await res.json();

      return data.map((item: any) => ({
        id: item.place_id?.toString() || Math.random().toString(),
        title: item.name || item.display_name.split(",")[0],
        subtitle: item.display_name,
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon),
      })) as Place[];
    } catch (error) {
      console.warn("Erreur recherche adresse:", error);
      return [];
    }
  },
};

/* ==================== TARIFICATION & CALCULS ZEM ==================== */

export type VehicleType = "ZEM" | "ZEM_ELECTRIC" | "CAR";
export type RideStatus = "PENDING" | "MATCHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type FareLine = {
  fromKm: number;
  toKm: number | null;
  km: number;
  perKm: number;
  amount: number;
};

export type Estimate = {
  distanceKm: number;
  etaMinutes: number;
  price: number;
  durationMin?: number;
  breakdown?: FareLine[];
};

export type Ride = {
  id: string;
  status: RideStatus;
  vehicleType: VehicleType;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  price: number;
  driverId?: string | null;
  driver?: { fullName: string; phone: string } | null;
};

// Formule de Haversine avec coefficient de voirie pour Cotonou/Calavi
export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const birdDistance = R * c;

  // Détours réels sur les routes : +35% par rapport au vol d'oiseau
  const roadDistance = birdDistance * 1.35;
  return Math.max(0.5, Math.round(roadDistance * 10) / 10);
}

/**
 * Grille tarifaire exacte pour les Zem :
 * - De 0 à 10 km : 90 FCFA / km
 * - De 10 à 25 km : 85 FCFA / km
 * - Plus de 25 km : 80 FCFA / km
 */
export function computeRidePrice(distanceKm: number, vehicleType: VehicleType = "ZEM"): number {
  let ratePerKm = 90;
  if (distanceKm > 25) {
    ratePerKm = 80;
  } else if (distanceKm > 10) {
    ratePerKm = 85;
  }

  let price = distanceKm * ratePerKm;

  // Si c'est une voiture, tarif confort x2
  if (vehicleType === "CAR") {
    price = price * 2;
  }

  // Arrondi propre à 25 FCFA près avec tarif minimum de 250 FCFA
  return Math.max(250, Math.round(price / 25) * 25);
}

/* ==================== COURSES (RIDES API) ==================== */

export const rideApi = {
  estimate: async (body: {
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    vehicleType: VehicleType;
  }) => {
    // 1. Calcul de la vraie distance routière
    const distanceKm = getDistanceKm(body.originLat, body.originLng, body.destLat, body.destLng);
    
    // 2. Calcul du temps estimé (~25 km/h)
    const etaMinutes = Math.max(3, Math.ceil((distanceKm / 25) * 60));

    // 3. Calcul du prix selon TON barème officiel :
    // - 0 à 10 km   : 90 FCFA / km
    // - 10 à 25 km  : 85 FCFA / km
    // - > 25 km     : 80 FCFA / km
    let ratePerKm = 90;
    if (distanceKm > 25) {
      ratePerKm = 80;
    } else if (distanceKm > 10) {
      ratePerKm = 85;
    }

    let basePrice = distanceKm * ratePerKm;

    // Réduction écologique de 50 FCFA sur le Zem électrique
    if (body.vehicleType === "ZEM_ELECTRIC") {
      basePrice = Math.max(200, basePrice - 50);
    } 
    // Tarif Voiture : x 1.8
    else if (body.vehicleType === "CAR") {
      basePrice = basePrice * 1.8;
    }

    // Arrondi propre à 25 FCFA près
    const finalPrice = Math.max(250, Math.round(basePrice / 25) * 25);

    // On renvoie directement le bon calcul à l'écran !
    return {
      distanceKm,
      etaMinutes,
      price: finalPrice,
    };
  },

  create: async (body: {
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    vehicleType: VehicleType;
  }) => {
    return await api.post<Ride>("/rides", body);
  },

  get: async (rideId: string) => {
    return await api.get<Ride>(`/rides/${rideId}`);
  },
};