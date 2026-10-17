// Client HTTP de l'app AZƆ̀ : parle au backend NestJS.
//
// ⚠️ IMPORTANT : mets l'IP de TON ordinateur dans azo-mobile/.env (EXPO_PUBLIC_API_URL).
// (commande : hostname -I  -> prends la première, ex. 192.168.1.23).
// "localhost" ne marche PAS depuis un téléphone : pour lui, localhost = le téléphone lui-même.
//   - Téléphone réel (Expo Go)  : http://192.168.x.x:3000
//   - Émulateur Android         : http://10.0.2.2:3000
//   - Navigateur (expo web)     : http://localhost:3000

import * as SecureStore from "expo-secure-store";
import { getLanguage, hasMessage, tr, type MessageKey } from "../i18n";

export const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_URL || "https://azo-backend.onrender.com";
export let API_URL = DEFAULT_API_URL;

export const setApiUrl = (url: string | null | undefined) => {
  const clean = (url || "").trim().replace(/\/+$/, "");
  API_URL = clean || DEFAULT_API_URL;
};
export const getApiUrl = () => API_URL;

// Préfixe des routes de réservation.
//  - "" (vide)  : routes servies par NestJS  -> /places/..., /rides/...
//  - "/api"     : si tu utilises un reverse-proxy qui préfixe les routes
const P = "";

let authToken: string | null = null;
export const setToken = (t: string | null) => {
  authToken = t;
};
// Utile pour charger une image protégée (<Image source={{ uri, headers }} />).
export const getToken = () => authToken;

/** Erreur API : `message` lisible + `status` HTTP + `data` (corps brut, ex: data.code). */
export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: any) {
    super(message);
  }
}

/**
 * Rend lisibles les erreurs techniques les plus fréquentes. En particulier : un
 * **backend resté sur une version antérieure** refuse encore les types de véhicules
 * actuels (`ZEM_ESSENCE`, `ZEM_ELECTRIC`, `GAZELLE`…) et répond par la liste de ses
 * anciennes valeurs — message incompréhensible pour l'utilisateur comme pour le client.
 */
function friendlyApiMessage(message: string): string {
  if (/vehicleType must be one of the following values/i.test(message)) {
    return (
      "Le serveur AZƆ̀ n'est pas à jour : il ne connaît pas encore ce type de véhicule.\n" +
      "Mets le backend à jour puis redémarre-le : git pull, npm install, " +
      "npx prisma generate, npx prisma migrate deploy.\n" +
      `(détail technique : ${message})`
    );
  }
  return message;
}

/**
 * Texte d'une erreur pour l'écran. Le serveur renvoie un `code` stable (ex. WALLET_INSUFFICIENT) :
 * s'il est connu de l'application, on affiche sa traduction dans la langue choisie ; sinon le
 * message français du serveur sert de secours.
 */
export const errorMessage = (e: unknown) => {
  if (e instanceof ApiError) {
    const code = typeof e.data?.code === "string" ? e.data.code : null;
    if (code && hasMessage(`err.${code}`)) return tr(`err.${code}` as MessageKey);
  }
  return friendlyApiMessage(e instanceof Error ? e.message : "Une erreur est survenue.");
};

/** Code d'erreur stable du serveur (ex. TIP_ALREADY_SENT), s'il y en a un. */
export const errorCode = (e: unknown): string | null =>
  e instanceof ApiError && typeof e.data?.code === "string" ? e.data.code : null;

/** La route n'existe pas encore sur le serveur (Nest répond « Cannot POST /… ») : fonction à venir. */
export const isRouteMissing = (e: unknown) =>
  e instanceof ApiError && e.status === 404 && /^Cannot (GET|POST|PATCH|PUT|DELETE) /.test(e.message);

async function requestOnce<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        // Langue de l'application : le serveur traduit ses notifications et ses libellés avec
        "Accept-Language": getLanguage(),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...((options.headers as Record<string, string>) ?? {}),
      },
      signal: controller.signal,
    });

    // Session glissante : le serveur renvoie un jeton neuf quand l'ancien vieillit. On le garde (mémoire + stockage sécurisé),
    // l'utilisateur reste connecté jusqu'à sa déconnexion.
    const refreshed = res.headers.get("x-refreshed-token");
    if (refreshed && authToken) {
      authToken = refreshed;
      SecureStore.setItemAsync("userToken", refreshed).catch(() => undefined);
    }

    return await handleResponse<T>(res);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error)?.name === "AbortError")
      throw new ApiError("Le serveur met trop de temps à répondre.", 0);
    throw new ApiError("Impossible de joindre le serveur. Vérifie ta connexion.", 0);
  } finally {
    clearTimeout(timer);
  }
}

// Render (offre gratuite) endort le serveur après un moment sans activité : à son réveil (30 à 60 s) la passerelle répond 502/503/504
// AVANT que l'API ne reçoive la requête. On réessaie donc automatiquement (sans risque de doublon : rien n'a été traité).
const WAKE_RETRY_STATUSES = [502, 503, 504];
const WAKE_RETRY_MAX = 6;
const WAKE_RETRY_DELAY_MS = 5000;

async function request<T>(path: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce<T>(path, options);
    } catch (e) {
      if (e instanceof ApiError && WAKE_RETRY_STATUSES.includes(e.status) && attempt < WAKE_RETRY_MAX) {
        await new Promise((resolve) => setTimeout(resolve, WAKE_RETRY_DELAY_MS));
        continue;
      }
      throw e;
    }
  }
}

/** Réveille le serveur sans attendre sa réponse (à l'ouverture de l'application) : il est prêt quand l'utilisateur saisit son numéro. */
export function wakeServer(): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70000);
  fetch(`${API_URL}/health`, { signal: controller.signal })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
}

const json = (body?: unknown) => (body === undefined ? undefined : JSON.stringify(body));

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // NestJS renvoie { message: "..." } ou { message: ["...", "..."] }
    const raw = data?.message ?? data?.error;
    const msg = Array.isArray(raw) ? raw.join("\n") : raw;
    throw new ApiError(msg || `Erreur ${res.status}`, res.status, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: { timeoutMs?: number }) => request<T>(path, opts),
  post: <T>(path: string, body?: unknown, opts?: { timeoutMs?: number; headers?: Record<string, string> }) =>
    request<T>(path, { method: "POST", body: json(body), ...opts }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: json(body) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: json(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/**
 * Envoi multipart via XMLHttpRequest (plus fiable sur React Native Android que fetch +
 * AbortController, qui échoue parfois sur les URI locales file:// / content://).
 */
function upload<T>(path: string, form: FormData, timeoutMs = 90000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader("Accept", "application/json");
    if (authToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
    }
    xhr.onload = () => {
      let data: any = {};
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
      } else {
        const raw = data?.message ?? data?.error;
        const msg = Array.isArray(raw) ? raw.join("\n") : raw;
        reject(new ApiError(msg || `Erreur ${xhr.status}`, xhr.status, data));
      }
    };
    xhr.onerror = () => {
      reject(new ApiError("Impossible d'envoyer la photo. Vérifie ta connexion et redémarre le backend.", 0));
    };
    xhr.ontimeout = () => {
      reject(new ApiError("L'envoi de la photo prend trop de temps. Réessaie avec une meilleure connexion.", 0));
    };
    xhr.send(form);
  });
}

/* ==================== AUTHENTIFICATION (SMS OTP) ==================== */

export type ProfileRole = "CLIENT" | "DRIVER" | "COURIER" | "AGENCY";

export const authApi = {
  requestOtp: (phone: string) =>
    api.post<{ message: string; phone: string; otpCode?: string }>("/auth/request-otp", { phone }),
  // `profile` n'accorde PLUS aucun rôle : il ouvre un brouillon de dossier prestataire
  // qu'un administrateur doit valider. Le rôle métier arrive avec l'approbation.
  verifyOtp: async (phone: string, code: string, profile: ProfileRole = "CLIENT") => {
    const r = await api.post<{ token: string; user: UserProfile; provider: ProviderRef | null; signupKind?: string | null }>("/auth/verify-otp", {
      phone,
      code,
      profile,
    });
    setToken(r.token); // toutes les requêtes suivantes sont authentifiées
    return r;
  },
};

/* ==================== UTILISATEUR ==================== */

export type UserProfile = {
  id: string;
  phone: string;
  fullName?: string | null;
  /** Inscription (après l'OTP) : renseignés une fois l'inscription terminée. */
  firstName?: string | null;
  lastName?: string | null;
  gender?: "M" | "F" | null;
  /** NPI masqué par le serveur (ex. « ••••••7890 ») : jamais renvoyé en clair. */
  npiMasked?: string | null;
  /**
   * `true` quand nom, prénom, sexe et NPI sont enregistrés. Absent tant que le serveur ne
   * gère pas l'inscription : l'application se rabat alors sur la présence de `fullName`.
   */
  profileComplete?: boolean;
  role: string;
  status?: "ACTIVE" | "PENDING_VALIDATION" | "BLOCKED";
  createdAt?: string;
  language?: string;
  /** Modifiables par le client (voir PROJECT_SUMMARY/DEMANDE_BACKEND_PROFIL_MESSAGERIE_POURBOIRE.md). */
  email?: string | null;
  emergencyContact?: { name: string; phone: string } | null;
  /** Fin de la fenêtre de correction directe du nom / prénom / sexe (null = fermée). */
  identityEditableUntil?: string | null;
  identityCorrectionPending?: boolean;
};

export type RegistrationPayload = {
  lastName: string;
  firstName: string;
  gender: "M" | "F";
  npi: string;
  /** Type de compte choisi à l'inscription (Client, Speeder, coursier, agence). */
  accountKind?: "CLIENT" | "DRIVER" | "COURIER" | "AGENCY";
};

/** Un compte doit-il encore passer par l'écran d'inscription ? */
export const needsRegistration = (user: Pick<UserProfile, "role" | "fullName" | "profileComplete">) =>
  String(user.role || "CLIENT").toUpperCase().trim() === "CLIENT" &&
  (user.profileComplete === false || (user.profileComplete === undefined && !user.fullName?.trim()));

export const userApi = {
  me: () => api.get<UserProfile>("/users/me"),
  update: (fullName: string) => api.patch<UserProfile>("/users/me", { fullName }),
  // POST /users/me/registration — voir PROJECT_SUMMARY/DEMANDE_BACKEND_INSCRIPTION.md
  register: (payload: RegistrationPayload) => api.post<UserProfile>("/users/me/registration", payload),
  /** Langue de l'application, mémorisée par le serveur (notifications et libellés traduits). */
  setLanguage: (language: string) => api.patch<UserProfile>("/users/me/language", { language }),
  /** E-mail et contact d'urgence : `null` supprime, clé absente = inchangé. */
  updateProfile: (body: { email?: string | null; emergencyContact?: { name: string; phone: string } | null }) =>
    api.patch<UserProfile>("/users/me/profile", body),
  /** Correction directe (une fois, dans la fenêtre de 24 h après l'inscription). */
  correctIdentity: (body: { firstName?: string; lastName?: string; gender?: "M" | "F" }) =>
    api.patch<UserProfile>("/users/me/identity", body),
  /** Demande de correction vérifiée par un administrateur (après la fenêtre). */
  requestIdentityCorrection: (body: { firstName?: string; lastName?: string; gender?: "M" | "F"; reason: string }) =>
    api.post<{ id: string; status: string }>("/users/me/identity-correction-requests", body),
  /** Changement de numéro : code SMS envoyé au NOUVEAU numéro, puis confirmation. */
  requestPhoneChange: (newPhone: string) =>
    api.post<{ expiresInSeconds?: number; maskedPhone?: string }>("/users/me/phone-change/request", { newPhone }),
  confirmPhoneChange: (code: string) =>
    api.post<UserProfile & { token?: string }>("/users/me/phone-change/confirm", { code }),
};

/* ==================== MESSAGERIE (onglet Messages) ==================== */

export type Conversation = {
  peer: { displayName?: string | null; role?: string; photoUrl?: string | null; verified?: boolean; vehicleType?: VehicleType | null };
  /** Course la plus récente avec cet interlocuteur ; `activeRideId` si une course est en cours. */
  lastRideId: string;
  lastRideStatus?: RideStatus;
  ridesCount?: number;
  lastMessage?: { text: string; at: string; fromMe: boolean } | null;
  unreadCount?: number;
  activeRideId?: string | null;
  canReply?: boolean;
};

export const messagesApi = {
  /** Boîte de réception : une ligne par interlocuteur (404 tant que le serveur ne la fournit pas). */
  conversations: () => api.get<{ items: Conversation[]; nextCursor?: string | null }>("/messages/conversations"),
  unreadCount: () => api.get<{ count: number }>("/messages/unread-count"),
};

/* ==================== PORTEFEUILLE AZƆ̀ PAY ==================== */

export type WalletTransaction = {
  id: string;
  type: "CREDIT" | "DEBIT";
  amount: number;
  label: string;
  meta: string | null;
  createdAt: string;
  /** CONFIRMED par défaut ; PENDING = recharge FedaPay pas encore confirmée par le webhook. */
  status?: "CONFIRMED" | "PENDING" | "FAILED";
};

export const walletApi = {
  get: () => api.get<{ balance: number; cashback: number }>("/wallet"),
  transactions: () => api.get<WalletTransaction[]>("/wallet/transactions"),
  // ⚠️ Simulation côté backend : le vrai paiement (FedaPay / KKiaPay) reste à brancher.
  recharge: (amount: number, method: string) =>
    api.post<{ url: string; transactionId: number }>("/wallet/recharge", { amount, method }),
};

/* ==================== CARTES / ADRESSES ==================== */

export type Place = { id?: string; title: string; subtitle?: string; latitude: number; longitude: number };

export type SavedPlaceKind = "HOME" | "WORK" | "OTHER";
export type SavedPlaceRow = { id: string; kind: SavedPlaceKind; title: string; address: string | null; latitude: number; longitude: number };
export type PlaceSuggestion = { title: string; latitude: number; longitude: number; rides: number };

export const placesApi = {
  /** Adresses enregistrées du client, conservées sur le serveur (suivent le client d'un téléphone à l'autre). */
  saved: () => api.get<{ places: SavedPlaceRow[] }>(`${P}/places/saved`),
  setSaved: (kind: "HOME" | "WORK", place: { title: string; address?: string; latitude: number; longitude: number }) =>
    api.put<SavedPlaceRow>(`${P}/places/saved/${kind}`, place),
  removeSaved: (id: string) => api.delete<{ removed: string }>(`${P}/places/saved/${id}`),
  /** Destinations les plus fréquentes d'après l'historique des courses. */
  suggestions: () => api.get<{ suggestions: PlaceSuggestion[] }>(`${P}/places/suggestions`),
  reverseGeocode: (latitude: number, longitude: number) =>
    api.post<{ address: string; fullAddress: string }>(`${P}/places/reverse-geocode`, { latitude, longitude }),
  search: async (q: string, near?: { latitude: number; longitude: number }) => {
    const qs = new URLSearchParams({ q });
    if (near) { qs.set("lat", String(near.latitude)); qs.set("lng", String(near.longitude)); }
    const r = await api.get<{ results: Place[] }>(`${P}/places/search?${qs.toString()}`);
    return r.results;
  },
};

/* ==================== COURSES (ZEM ESSENCE / ZEM ÉLECTRIQUE / VOITURE) ==================== */

/**
 * Véhicules AZƆ̀ (barème tarifaire), en deux filières distinctes :
 *   * ZEM_ESSENCE / ZEM_ELECTRIC → les motos-taxis (Speeder), facturés au même tarif ;
 *   * GAZELLE / KOALA / LEOPARD  → les voitures proposées pour une course.
 * Les anciens types ZEM / CAR ne sont plus proposés : les courses passées sont
 * rattachées à un véhicule (ZEM → ZEM_ESSENCE ; CAR → KOALA) via `services/tarification`.
 */
export type VehicleType = "ZEM_ESSENCE" | "ZEM_ELECTRIC" | "ZEM_TRICYCLE" | "GAZELLE" | "KOALA" | "LEOPARD";

/** Filière d'un véhicule : moto-taxi (Speeder) ou voiture. */
export type VehicleFamily = "ZEM" | "CAR";
// OFFERED : un Speeder a accepté, le client doit confirmer (voir PROJECT_SUMMARY/DEMANDE_BACKEND_RADAR_PROFIL_ZEM_ET_CARTE.md)
export type RideStatus = "PENDING" | "OFFERED" | "MATCHED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

// ⚠️ N'ajoute AUCUN autre champ : le backend refuse les champs inconnus.
export type RideRequest = {
  originLat: number; originLng: number; destLat: number; destLng: number; vehicleType: VehicleType;
  /** Adresses lisibles (facultatives) : le serveur les renvoie au Speeder, qui n'a plus à les géocoder. */
  originLabel?: string; destLabel?: string;
  /** Course programmée : heure de prise en charge souhaitée (ISO 8601). Absent = tout de suite. */
  scheduledAt?: string;
};

export type Estimate = {
  distanceKm: number;
  etaMinutes: number;
  price: number;
  durationMin?: number;
  /** Véhicule facturé (ZEM_ESSENCE … LEOPARD), renvoyé par le backend. */
  gamme?: VehicleType;
  /** Détail du calcul officiel : base + tranches kilométriques (config tarification). */
  breakdown?: {
    gamme: VehicleType;
    family?: VehicleFamily;
    distanceKm: number;
    /** Base facturée (après remise éventuelle). */
    base: number;
    baseFull: number;
    baseDiscountPct: number;
    baseDiscountApplied: boolean;
    baseDiscountAboveKm: number | null;
    /** Une ligne par palier kilométrique (km facturés et montant). */
    brackets: { upToKm: number | null; perKm: number; km: number; amount: number }[];
    price: number;
    currency: string;
  };
};

/**
 * Profil public d'un Speeder, montré au client AVANT qu'il confirme (statut OFFERED).
 * Tous les champs sont facultatifs : l'application affiche seulement ce que le serveur fournit.
 */
export type DriverPublicProfile = {
  displayName?: string | null;
  photoUrl?: string | null;
  verified?: boolean;
  /** Moyenne des notes (null = pas encore noté). */
  rating?: number | null;
  ratingCount?: number;
  jobsCompleted?: number;
  experienceYears?: number | null;
  memberSince?: string | null;
  city?: string | null;
  zones?: string[];
  bio?: string | null;
  vehicleType?: VehicleType | null;
  vehicleModel?: string | null;
  plateMasked?: string | null;
  agencyName?: string | null;
};

export type RidePerson = {
  fullName?: string | null;
  phone?: string | null;
  /** « Kossi A. » (nom d'affichage fourni par le serveur) et prénom seul. */
  displayName?: string | null;
  firstName?: string | null;
  /** Sur le radar du Speeder : note moyenne donnée par les chauffeurs, nombre de notes, courses terminées. */
  rating?: number | null;
  ratedCount?: number;
  rides?: number;
  /** Présent côté client pour le Speeder de la course. */
  profile?: DriverPublicProfile | null;
};

export type Ride = {
  id: string;
  clientId: string;
  driverId: string | null;
  status: RideStatus;
  vehicleType: VehicleType;
  originLat: number; originLng: number; destLat: number; destLng: number;
  price: number;
  commission?: number;
  rating?: number | null;
  /** Course programmée : heure souhaitée, et moment où la demande a été ouverte aux chauffeurs (null = pas encore). */
  scheduledAt?: string | null;
  scheduledReleasedAt?: string | null;
  /** Visible uniquement au client lorsque le chauffeur a signalé son arrivée. */
  pickupCode?: string | null;
  /** Visible uniquement au client pendant IN_PROGRESS, à saisir pour terminer la course. */
  dropCode?: string | null;
  driverArrivedAt?: string | null;
  /** Pourboire déjà envoyé pour cette course, et date limite pour en donner un (client, course terminée). */
  tip?: { amount: number; at?: string } | null;
  tipUntil?: string | null;
  /**
   * Course partielle (prix au kilomètre parcouru) — voir
   * PROJECT_SUMMARY/DEMANDE_BACKEND_PRIX_AU_KILOMETRE_ET_CARTES.md. Tous ces champs sont absents
   * tant que le serveur ne les fournit pas : l'application masque alors la fonction.
   */
  /** Distance réellement parcourue depuis le départ de la course, en mètres. */
  traveledMeters?: number;
  /** Prix si la course s'arrêtait maintenant (d'après la distance parcourue). */
  currentPrice?: number;
  /** Demande d'arrêt en cours : qui l'a faite et pour quel montant. */
  stopRequest?: { by: "CLIENT" | "DRIVER"; at?: string; expiresAt?: string; price?: number; distanceMeters?: number; accepted?: boolean; codeRequired?: boolean } | null;
  /** Une fois la course terminée : distance facturée et mode (`FULL` = prix estimé, `PARTIAL` = arrêt anticipé). */
  settledDistanceMeters?: number;
  priceMode?: "FULL" | "PARTIAL" | null;
  /** Montant réellement débité à la fin (peut différer de `price`, l'estimation initiale). */
  finalPrice?: number;
  /** Pourquoi la proposition du Speeder a pris fin (vue restreinte du Speeder) : voir DEMANDE_BACKEND_FIN_PROPOSITION_ZEM.md */
  offerOutcome?: "approved" | "declined" | "expired" | "withdrawn" | "cancelled" | null;
  /** Proposition d'un Speeder en attente de la confirmation du client (statut OFFERED). */
  offerExpiresAt?: string | null;
  /** Quand le client a ouvert la popup (null = pas encore vu ; absent = le serveur ne le dit pas). */
  offerSeenAt?: string | null;
  offer?: { expiresAt?: string; distanceKm?: number | null; etaMinutes?: number | null } | null;
  /** Position du client relue par le Speeder (MATCHED / ARRIVED), si le serveur la fournit. */
  clientLat?: number | null;
  clientLng?: number | null;
  clientLocatedAt?: string | null;
  /** Adresses lisibles du départ et de la destination, si le serveur les fournit. */
  originLabel?: string | null;
  destLabel?: string | null;
  /** Dernière position connue du chauffeur, si le serveur la conserve (sinon absent). */
  driverLocation?: { lat: number; lng: number; heading?: number; speed?: number; at?: number } | null;
  createdAt: string;
  driver?: RidePerson | null;
  client?: RidePerson | null;
  /* --- Champs calculés par le radar du serveur (voir GET /rides/pending) --- */
  /** Distance entre la position transmise et le point de départ, en km. */
  distanceKm?: number | null;
  /** Âge de la demande, en minutes. */
  ageMinutes?: number;
  /** Minutes restantes avant que la demande n'expire (elle est alors annulée). */
  expiresInMinutes?: number;
  /** `true` quand la demande a expiré sans chauffeur : elle vient d'être annulée. */
  expired?: boolean;
};

export type RideChatMessage = {
  id: string;
  rideId: string;
  senderId: string;
  senderRole: "CLIENT" | "PROVIDER";
  senderName: string;
  text: string;
  createdAt: string;
};

/** Itinéraire calculé par le serveur (mis en cache) vers l'étape en cours de la course. */
export type RideRoute = {
  rideId: string;
  stage: "pickup" | "destination";
  coordinates: { latitude: number; longitude: number }[];
  distanceKm: number;
  durationMinutes: number;
  computedAt: string;
  /** `true` : OSRM était indisponible, le serveur renvoie le dernier itinéraire valide. */
  fallback: boolean;
};

/** Montant réellement payé : le prix final d'une course terminée, sinon le prix estimé. */
export const paidAmount = (ride: Pick<Ride, "price" | "finalPrice">) => ride.finalPrice ?? ride.price;

export type DriverEarnings = {
  period: "day" | "week" | "month";
  from: string;
  days: { date: string; gross: number; net: number; rides: number }[];
  totals: { gross: number; net: number; rides: number; commission: number };
  averagePerActiveDay: number;
  bestDay: { date: string; net: number } | null;
};

export type RideReceipt = {
  reference: string;
  date: string;
  currency: string;
  amount: number;
  vehicleType: VehicleType;
  originLabel: string | null;
  destLabel: string | null;
  distanceKm: number;
  priceMode: string;
  paymentMethod: string;
  client: string | null;
  driver: string | null;
  vehicle: { model: string | null; plate: string | null } | null;
  commission?: number;
  net?: number;
};

export type Standing = {
  role: "CLIENT" | "DRIVER";
  rating: number | null;
  count: number;
  level: "OK" | "WARNING" | "RESTRICTED";
  windowDays: number;
  minRatings: number;
  warnBelow: number;
  restrictBelow: number;
};

export const ridesApi = {
  /** `stage=trip` : départ du client → destination, quelle que soit l'étape (voir le md backend, C.2.2). */
  route: (rideId: string, stage?: "trip") =>
    api.get<RideRoute>(`${P}/rides/${rideId}/route${stage ? `?stage=${stage}` : ""}`),
  /* --- Client --- */
  estimate: (body: RideRequest) => api.post<Estimate>(`${P}/rides/estimate`, body),
  create: (body: RideRequest) => api.post<Ride>(`${P}/rides`, body),
  get: (id: string) => api.get<Ride>(`${P}/rides/${id}`, { timeoutMs: 8000 }),
  history: () => api.get<Ride[]>(`${P}/rides/history`),
  /** Gains détaillés du chauffeur sur 1, 7 ou 30 jours (jours locaux). */
  earnings: (period: "day" | "week" | "month") => api.get<DriverEarnings>(`${P}/rides/earnings?period=${period}`),
  /** Ma note récente et ma situation (OK / avertissement / restriction), client ou chauffeur. */
  standing: () => api.get<Standing>(`${P}/rides/standing`),
  /** Le chauffeur note le client (1 à 5) après la course. */
  rateClient: (rideId: string, stars: number) => api.post<{ rated: boolean; stars: number }>(`${P}/rides/${rideId}/rate-client`, { stars }),
  /** Reçu d'une course terminée (client ou chauffeur). */
  receipt: (rideId: string) => api.get<RideReceipt>(`${P}/rides/${rideId}/receipt`),
  /** Alerte SOS pendant une course : prévient AZƆ̀ et l'autre participant. */
  sos: (rideId: string, position?: { lat: number; lng: number }) =>
    api.post<{ sent: boolean; notifiedAdmins: number }>(`${P}/rides/${rideId}/sos`, position ?? {}),
  rate: (rideId: string, stars: number) => api.post<Ride>(`${P}/rides/${rideId}/rate`, { stars }),
  cancel: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/cancel`),

  /* --- Conducteur --- */
  /** Radar du chauffeur : sa position est transmise pour filtrer et classer par proximité. */
  pending: (position?: { latitude: number; longitude: number }, radiusKm?: number) =>
    api.get<Ride[]>(
      `${P}/rides/pending` +
        (position
          ? `?lat=${encodeURIComponent(position.latitude)}&lng=${encodeURIComponent(position.longitude)}` +
            (radiusKm ? `&radiusKm=${radiusKm}` : "")
          : "")
    ),
  /** Nombre de clients disponibles autour du Speeder (absent du serveur = 404 : l'application compte elle-même). */
  pendingSummary: (position: { latitude: number; longitude: number }, radiusKm: number) =>
    api.get<{ radiusKm: number; count: number; nearestKm: number | null }>(
      `${P}/rides/pending/summary?lat=${encodeURIComponent(position.latitude)}&lng=${encodeURIComponent(position.longitude)}&radiusKm=${radiusKm}`
    ),
  /** Le serveur répond OFFERED (le client doit confirmer) ou MATCHED (ancien comportement). */
  accept: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/accept`),
  /** Le Speeder retire sa proposition tant que le client n'a pas confirmé. */
  withdrawOffer: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/withdraw-offer`),
  /** Propositions de Speeder en attente de ma décision (rattrapage de la popup) — 404 tant que le serveur ne l'a pas. */
  /** Ma proposition en cours + la dernière terminée (10 min) : reprise après redémarrage du Speeder. 404 tant que le serveur ne l'a pas. */
  currentOffer: () =>
    api.get<{ offer: { rideId: string; status: string; expiresAt: string } | null; lastEnded: { rideId: string; outcome: string; endedAt: string } | null }>(`${P}/rides/offers/current`),
  pendingOffers: () => api.get<{ offers: { rideId: string }[] }>(`${P}/rides/offers/pending`),
  /** Dit au Speeder que le client regarde sa proposition (popup affichée). */
  offerSeen: (rideId: string) => api.post<{ seenAt?: string }>(`${P}/rides/${rideId}/offer-seen`),
  /** Le client choisit ce Speeder (OFFERED → MATCHED) ou le refuse (OFFERED → PENDING). */
  approveDriver: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/approve-driver`),
  declineDriver: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/decline-driver`),
  driverProfile: (rideId: string) => api.get<DriverPublicProfile>(`${P}/rides/${rideId}/driver-profile`),
  arrive: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/arrive`),
  start: (rideId: string, pin: string) => api.post<Ride>(`${P}/rides/${rideId}/start`, { pin }),
  requestDropCode: (rideId: string) =>
    api.post<{ dropCodeRequested: boolean }>(`${P}/rides/${rideId}/drop-code`),
  complete: (rideId: string, code: string) =>
    api.post<Ride>(`${P}/rides/${rideId}/complete`, { code }),

  /* --- Arrêt anticipé : on ne paie que la distance parcourue, avec l'accord des deux --- */
  requestStop: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/stop-request`),
  acceptStop: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/stop-accept`),
  declineStop: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/stop-decline`),
  cancelStop: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/stop-cancel`),

  /** Pourboire : 100 % reversé au Speeder, débité du portefeuille. `Idempotency-Key` évite un double débit. */
  tip: (rideId: string, amount: number, idempotencyKey: string) =>
    api.post<{ rideId: string; tipId?: string; amount: number; balance?: number; at?: string }>(
      `${P}/rides/${rideId}/tip`,
      { amount },
      { headers: { "Idempotency-Key": idempotencyKey } }
    ),

  /* --- Messagerie sécurisée in-app --- */
  // Le serveur renverra `{ items }` (pagination) ; l'ancien format est un simple tableau.
  messages: async (rideId: string): Promise<RideChatMessage[]> => {
    const res = await api.get<RideChatMessage[] | { items: RideChatMessage[] }>(`${P}/rides/${rideId}/messages`);
    return Array.isArray(res) ? res : (res?.items ?? []);
  },
  /** Marque comme lus les messages reçus de cette course (sans effet tant que la route n'existe pas). */
  markRead: (rideId: string) => api.post<{ unreadTotal?: number }>(`${P}/rides/${rideId}/messages/read`),
  sendMessage: (
    rideId: string,
    body: { text: string; senderRole?: "CLIENT" | "PROVIDER"; senderName?: string }
  ) => api.post<RideChatMessage>(`${P}/rides/${rideId}/messages`, body),
};

// Alias historique : les écrans plus anciens importent `rideApi`.
export const rideApi = ridesApi;

/* ==================== LIVRAISON DE COLIS & COURSIER ==================== */

export type DeliveryStatus = "PENDING" | "MATCHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type Delivery = {
  id: string;
  clientId?: string;
  courierId?: string | null;
  status: DeliveryStatus;
  packageType: string;
  pickupAddress: string;
  dropAddress: string;
  payer: "SENDER" | "RECIPIENT";
  price: number;
  commission?: number;
  pickupCode: string;
  deliveryCode: string;
  createdAt: string;
  /** "PERSONAL" = coursier personnel réservé pour une durée. */
  mode?: "EXPRESS" | "PERSONAL";
  vehicleType?: VehicleType | null;
  bookingHours?: number | null;
  bookedFrom?: string | null;
  bookedUntil?: string | null;
  scheduledAt?: string | null;
  distanceKm?: number | null;
  traveledMeters?: number;
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickupDistanceKm?: number | null;
  client?: RidePerson | null;
  courier?: RidePerson | null;
};

/** Suivi en direct d'une livraison (position du coursier, kilomètres parcourus). */
export type DeliveryTrack = {
  id: string;
  status: DeliveryStatus;
  mode: "EXPRESS" | "PERSONAL";
  courierLat: number | null;
  courierLng: number | null;
  courierLocatedAt: string | null;
  traveledMeters: number;
};

export const deliveryApi = {
  /* --- Client --- */
  create: (body: {
    packageType: string;
    pickupAddress: string;
    dropAddress?: string;
    payer: "SENDER" | "RECIPIENT";
    /** Livraison express : prix proposé. Coursier personnel : calculé par le serveur. */
    price?: number;
    mode?: "EXPRESS" | "PERSONAL";
    vehicleType?: VehicleType;
    bookingHours?: number;
    /** Coursier personnel : départ programmé (ISO 8601). */
    scheduledAt?: string;
    pickupLat?: number;
    pickupLng?: number;
    dropLat?: number;
    dropLng?: number;
  }) => api.post<Delivery>(`${P}/deliveries`, body),
  mine: () => api.get<Delivery[]>(`${P}/deliveries`),
  /** Prix exact d'un colis, calculé par le serveur sur la distance de l'itinéraire. */
  quote: (q: { vehicleType: VehicleType; packageType: string; pickupLat: number; pickupLng: number; dropLat: number; dropLng: number }) =>
    api.get<{ km: number; price: number }>(`${P}/deliveries/quote?vehicleType=${q.vehicleType}&packageType=${q.packageType}&pickupLat=${q.pickupLat}&pickupLng=${q.pickupLng}&dropLat=${q.dropLat}&dropLng=${q.dropLng}`),
  track: (id: string) => api.get<DeliveryTrack>(`${P}/deliveries/${id}/track`),
  /** Coursier : position GPS pendant la mission. */
  location: (id: string, body: { latitude: number; longitude: number; accuracy?: number }) =>
    api.post<{ traveledMeters: number }>(`${P}/deliveries/${id}/location`, body),
  cancel: (id: string) => api.post<Delivery>(`${P}/deliveries/${id}/cancel`),

  /* --- Coursier / Livreur --- */
  /** Missions dans un rayon de 10 km autour de la position donnée. */
  pending: (near?: { latitude: number; longitude: number }) =>
    api.get<Delivery[]>(`${P}/deliveries/pending${near ? `?lat=${near.latitude}&lng=${near.longitude}` : ""}`),
  courierHistory: () => api.get<Delivery[]>(`${P}/deliveries/courier`),
  accept: (id: string) => api.post<Delivery>(`${P}/deliveries/${id}/accept`),
  confirmPickup: (id: string, code: string) =>
    api.post<Delivery>(`${P}/deliveries/${id}/confirm-pickup`, { code }),
  confirmDelivery: (id: string, code: string) =>
    api.post<Delivery>(`${P}/deliveries/${id}/confirm-delivery`, { code }),
};

/* ==================== LOCATION DE VÉHICULES ==================== */

export type RentalBooking = {
  id: string; vehicleModel: string; formula: string; pricePerDay: number; status: string; createdAt: string;
};

export type RentalFormula = "4h" | "day" | "week";

export type RentalVehicle = {
  id: string;
  name: string;
  seats: number;
  pricePerDay: number;
  price4h: number | null;
  priceWeek: number | null;
  /** Formules réellement proposées, avec leur prix (calculé par le serveur). */
  formulas: { id: RentalFormula; price: number }[];
};

export type SupportCategory = "RIDE" | "PAYMENT" | "ACCOUNT" | "SAFETY" | "OTHER";
export type SupportStatus = "OPEN" | "ANSWERED" | "CLOSED";
export type SupportMessage = { id: string; authorRole: "USER" | "ADMIN"; text: string; createdAt: string };
export type SupportTicketSummary = {
  id: string;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  rideId: string | null;
  updatedAt: string;
  lastMessage: { authorRole: "USER" | "ADMIN"; text: string } | null;
  /** Renseigné pour l'administrateur : qui a écrit. */
  user?: { fullName: string | null; phone: string; role: string };
};
export type SupportTicket = Omit<SupportTicketSummary, "lastMessage"> & {
  createdAt: string;
  messages: SupportMessage[];
  user?: { fullName: string | null; phone: string; role: string };
};

export const supportApi = {
  create: (body: { category: SupportCategory; subject: string; message: string; rideId?: string }) =>
    api.post<SupportTicket>(`${P}/support/tickets`, body),
  list: () => api.get<{ tickets: SupportTicketSummary[] }>(`${P}/support/tickets`),
  get: (id: string) => api.get<SupportTicket>(`${P}/support/tickets/${id}`),
  reply: (id: string, text: string) => api.post<SupportMessage>(`${P}/support/tickets/${id}/messages`, { text }),
  admin: {
    list: (status?: SupportStatus) =>
      api.get<{ tickets: SupportTicketSummary[] }>(`${P}/admin/support/tickets${status ? `?status=${status}` : ""}`),
    get: (id: string) => api.get<SupportTicket>(`${P}/admin/support/tickets/${id}`),
    reply: (id: string, text: string) => api.post<SupportMessage>(`${P}/admin/support/tickets/${id}/reply`, { text }),
    close: (id: string) => api.post<{ id: string; status: SupportStatus }>(`${P}/admin/support/tickets/${id}/close`),
  },
};

export const rentalApi = {
  catalog: () => api.get<RentalVehicle[]>(`${P}/rentals/catalog`),
  /** Le prix total est calculé par le serveur : on n'envoie que le véhicule, la formule et le nombre de jours. */
  book: (body: { vehicleId: string; formula: RentalFormula; days?: number }) => api.post<RentalBooking & { totalPrice?: number }>(`${P}/rentals`, body),
  mine: () => api.get<RentalBooking[]>(`${P}/rentals/mine`),
};

/* ==================== COURSES AU MARCHÉ (MARKETPLACE) ==================== */

export type MarketplaceOrder = {
  id: string; market: string; total: number; status: string; createdAt: string;
};

export const marketplaceApi = {
  order: (body: { market: string; items: { label: string; note?: string; price: number }[] }) =>
    api.post<MarketplaceOrder>(`${P}/marketplace/orders`, body),
  validate: (orderId: string) => api.post<MarketplaceOrder>(`${P}/marketplace/orders/${orderId}/validate`),
};

/* ==================== ARTISANS (V2) ==================== */

export const artisansApi = {
  list: (category?: string) =>
    api.get<{ id: string; fullName?: string | null; phone: string }[]>(
      `${P}/artisans${category ? `?category=${encodeURIComponent(category)}` : ""}`
    ),
  request: (category: string) => api.post<{ id: string; category: string; status: string }>(`${P}/artisans/requests`, { category }),
};

/* ==================== NOTIFICATIONS ==================== */

export type AppNotification = { id: string; title: string; body: string; type: string; read: boolean; createdAt: string };

export const notificationsApi = {
  list: () => api.get<AppNotification[]>(`${P}/notifications`),
  readAll: () => api.post<{ count: number }>(`${P}/notifications/read-all`),
  registerPushToken: (token: string, platform: "android" | "ios") =>
    api.post<{ registered: boolean }>(`${P}/notifications/push-token`, { token, platform }),
  unregisterPushToken: (token: string, platform: "android" | "ios") =>
    api.post<{ unregistered: boolean }>(
      `${P}/notifications/push-token/unregister`,
      { token, platform },
      { timeoutMs: 6000 }
    ),
};

/* ============ PRESTATAIRES : dossier, pièces, validation admin ============ */

export type ProviderType = "DRIVER" | "AGENCY" | "ARTISAN" | "COURIER";
export type ProviderStatus =
  | "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "NEED_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type DocumentKind =
  | "CNI" | "SELFIE" | "PERMIS" | "CARTE_GRISE" | "ASSURANCE" | "VISITE_TECHNIQUE"
  | "PHOTO_VEHICULE" | "RCCM" | "IFU" | "STATUTS" | "DIPLOME" | "EXTRAIT_CASIER" | "PROFILE_PHOTO" | "LOGO";
export type DocumentReview = "PENDING" | "VALID" | "INVALID";
export type AgencyPlanChoice = "PRO" | "SILVER" | "OR" | "DIAMANT" | "PLATINE" | "ELITE";

/** Référence courte renvoyée par /auth/verify-otp. */
export type ProviderRef = { id: string; type: ProviderType; status: ProviderStatus };

export type ProviderChecklistItem = {
  kind: DocumentKind;
  label: string;
  required: boolean;
  photoRequired: boolean;
  status: DocumentReview | "MISSING";
  hasFile: boolean;
  expiresAt: string | null;
  expired: boolean;
  expiresSoon: boolean;
  note: string | null;
  documentId: string | null;
};

export type ProviderDocumentView = {
  id: string;
  kind: DocumentKind;
  label: string;
  status: DocumentReview;
  url: string | null;
  hasFile: boolean;
  expiresAt: string | null;
  note: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
};

export type AgencyDetails = {
  representativeFirstName?: string;
  representativeLastName?: string;
  representativeRole?: string;
  representativeNpi?: string;
  agencyType?: string;
  legalForm?: string;
  ifuNumber?: string;
  rccmNumber?: string;
  headquartersAddress?: string;
  businessPhone?: string;
  businessEmail?: string;
  payoutPhone?: string;
  fleetSize?: number;
};

export type ProviderDossier = {
  id: string;
  type: ProviderType;
  typeLabel: string;
  status: ProviderStatus;
  identity: {
    fullName: string | null;
    city: string | null;
    zones: string[];
    bio: string | null;
    experienceYears: number | null;
  };
  activity: {
    vehicleType: VehicleType | null;
    vehicleModel: string | null;
    plateNumber: string | null;
    categoryId: string | null;
    agencyName: string | null;
    plan: AgencyPlanChoice | null;
    planLabel: string | null;
    planFee: number | null;
    planCommissionRate: number | null;
    agencyDetails?: AgencyDetails | null;
  };
  review: {
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewedById: string | null;
    rejectReason: string | null;
    suspensionReason: string | null;
    infoRequested: string | null;
    waitingHours: number | null;
    slaHours: number;
    overdue: boolean;
    canResubmitAt: string | null;
  };
  activation: { activatedAt: string | null; rating: number; jobsCompleted: number; kycScore: number };
  agencyId: string | null;
  documents: ProviderDocumentView[];
  checklist: ProviderChecklistItem[];
  missingDocuments: { kind: DocumentKind; label: string }[];
  missingFields: string[];
  editable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProviderTimelineEntry = {
  id: string;
  type: string;
  comment: string | null;
  byAdmin?: boolean;
  actorId?: string | null;
  createdAt: string;
};

export type ProviderMe = {
  account: { id: string; phone: string; fullName: string | null; role: string; status: string; agencyId: string | null };
  provider: ProviderDossier | null;
  canApply: boolean;
  enabledTypes?: {
    type: ProviderType;
    label: string;
    requiredDocuments: { kind: DocumentKind; label: string; photoRequired: boolean }[];
    requiredFields: string[];
  }[];
  timeline?: ProviderTimelineEntry[];
};

export type ProviderRequirements = {
  enabledTypes: ProviderType[];
  types: {
    type: ProviderType;
    label: string;
    description: string;
    enabled: boolean;
    vehicleChoices: { value: VehicleType; label: string; hint: string; family?: VehicleFamily }[];
    specialties?: { id: string; label: string; hint: string }[];
    requiredFields: { field: string; label: string }[];
    requiredDocuments: { kind: DocumentKind; label: string; photoRequired: boolean }[];
    optionalDocuments: { kind: DocumentKind; label: string; photoRequired: boolean }[];
  }[];
  plans: { plan: AgencyPlanChoice; label: string; fee: number; maxAccounts: number; commissionRate: number }[];
  review: { slaHours: number; resubmitDelayDays: number };
  upload: { maxBytes: number; acceptedMimeTypes: string[] };
};

/** Champs du wizard, tous optionnels : le brouillon se complète étape par étape. */
export type ProviderApplicationDraft = {
  type?: ProviderType;
  fullName?: string;
  city?: string;
  zones?: string[];
  bio?: string;
  experienceYears?: number;
  vehicleType?: VehicleType;
  vehicleModel?: string;
  plateNumber?: string;
  categoryId?: string;
  agencyName?: string;
  plan?: AgencyPlanChoice;
  representativeFirstName?: string;
  representativeLastName?: string;
  representativeRole?: string;
  representativeNpi?: string;
  agencyType?: string;
  legalForm?: string;
  ifuNumber?: string;
  rccmNumber?: string;
  headquartersAddress?: string;
  businessPhone?: string;
  businessEmail?: string;
  payoutPhone?: string;
  fleetSize?: number;
};

/** Fichier choisi sur le téléphone (expo-image-picker). */
export type PickedFile = { uri: string; name: string; type: string; base64?: string | null };

export const providersApi = {
  requirements: () => api.get<ProviderRequirements>(`${P}/providers/requirements`),
  me: () => api.get<ProviderMe>(`${P}/providers/me`),
  /** Supprime l'inscription professionnelle commencée mais jamais déposée (brouillon). */
  deleteDraft: (id: string) => api.delete<{ deleted: string }>(`${P}/providers/applications/${id}`),
  save: (draft: ProviderApplicationDraft) =>
    api.post<ProviderDossier>(`${P}/providers/applications`, draft),
  declareDocument: (id: string, kind: DocumentKind, expiresAt?: string | null) =>
    api.post<ProviderDocumentView>(`${P}/providers/applications/${id}/documents`, {
      kind,
      ...(expiresAt ? { expiresAt } : {}),
    }),
  /**
   * Dépôt de la photo d'une pièce :
   * 1) Envoie d'abord en JSON base64 (utilise le même canal JSON fiable que le reste de l'app,
   *    sans échec multipart file:// sur Android).
   * 2) Si le serveur ne connaît pas encore la route base64 ou si base64 est absent,
   *    bascule sur XMLHttpRequest multipart.
   */
  uploadDocument: async (id: string, kind: DocumentKind, file: PickedFile) => {
    if (file.base64) {
      try {
        return await api.post<ProviderDocumentView>(
          `${P}/providers/applications/${id}/documents/${kind}/base64`,
          {
            base64: file.base64,
            mimeType: file.type,
            fileName: file.name,
          },
          { timeoutMs: 60000 }
        );
      } catch (err) {
        // Si le serveur renvoie une erreur métier explicite (dossier non modifiable, format...), on la remonte
        if (err instanceof ApiError && err.status >= 400 && err.status !== 404 && err.status !== 413) {
          throw err;
        }
        // Sinon (ex: ancien backend non redémarré), on tente l'envoi multipart XHR
      }
    }
    const form = new FormData();
    form.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob);
    return upload<ProviderDocumentView>(`${P}/providers/applications/${id}/documents/${kind}/file`, form);
  },
  submit: (id: string) => api.post<ProviderDossier>(`${P}/providers/applications/${id}/submit`),
  /**
   * Source prête pour <Image> : passe le jeton à la fois dans ?token= (pour le chargeur
   * d'images Android Fresco) et dans l'en-tête Authorization.
   */
  fileSource: (documentId: string) => ({
    uri: `${API_URL}${P}/providers/documents/${documentId}/file${
      authToken ? `?token=${encodeURIComponent(authToken)}` : ""
    }`,
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
  }),
};

/* ==================== ESPACE AGENCE DE FLOTTE ==================== */

export type AgencyRosterMember = {
  id: string;
  fullName: string | null;
  phone: string;
  status: string;
  activeRides: number;
  state: "EN_COURSE" | "DISPONIBLE";
  rating: number;
  jobsCompleted: number;
  /** Solde du portefeuille du chauffeur (FCFA). */
  balance?: number;
};

export type AgencyDashboardData = {
  agency: {
    id: string;
    name: string;
    plan: AgencyPlanChoice;
    planLabel: string;
    commissionRate: number;
    maxAccounts: number;
    activationFee: number;
    feePaidAt: string | null;
    createdAt: string;
  };
  drivers: number;
  completedRides: number;
  netRevenue: number;
  grossRevenue: number;
  commissionsPaid: number;
  averageRating: number | null;
  seatsUsed: number;
  seatsTotal: number;
  activeRides: number;
  /** Niveau d'agence : commission et frais de retrait de la grille officielle. */
  commissionPct: number;
  withdrawalFeePct: number;
  /** Activation : paiement unique des frais du niveau avant toute opération. */
  activated: boolean;
  /** Solde du portefeuille de l'agence (FCFA). */
  walletBalance?: number;
  roster: AgencyRosterMember[];
};

export type AgencyTransferResult = {
  direction: "fund" | "withdraw";
  amount: number;
  replayed: boolean;
  agencyBalance: number;
  driver: { id: string; balance: number };
};

export const agenciesApi = {
  dashboard: () => api.get<AgencyDashboardData>(`${P}/agencies/dashboard`),
  /** Paiement unique des frais d'activation du niveau (une seule fois, non récurrent). */
  activate: () =>
    api.post<{
      agencyId: string;
      plan: AgencyPlanChoice;
      activationFee: number;
      feePaidAt: string;
      canOperate: boolean;
    }>(`${P}/agencies/activate`),
  attachDriver: (phone: string) =>
    api.post<{ driver: { id: string; phone: string; fullName: string | null }; agencyId: string }>(
      `${P}/agencies/drivers`,
      { phone }
    ),
  /** L'agence recharge le compte d'un de ses chauffeurs (portefeuille agence → chauffeur). */
  fundDriver: (userId: string, amount: number, idempotencyKey: string) =>
    api.post<AgencyTransferResult>(`${P}/agencies/drivers/${userId}/fund`, { amount }, { headers: { "Idempotency-Key": idempotencyKey } }),
  /** L'agence retire de l'argent du compte d'un chauffeur (chauffeur → portefeuille agence). */
  withdrawFromDriver: (userId: string, amount: number, idempotencyKey: string) =>
    api.post<AgencyTransferResult>(`${P}/agencies/drivers/${userId}/withdraw`, { amount }, { headers: { "Idempotency-Key": idempotencyKey } }),
  detachDriver: (userId: string) =>
    api.delete<{ detached: string; agencyId: string }>(`${P}/agencies/drivers/${userId}`),
};

/* ==================== TABLEAU DE BORD ADMINISTRATEUR ==================== */

export type AdminGlobalStats = {
  users: number;
  rides: number;
  completedRides: number;
  deliveries?: number;
  completedDeliveries?: number;
  commissionsRevenue: number;
  agencies: number;
  providersPending?: number;
  providersApproved?: number;
  blockedUsers?: number;
};

/** Gains de l'entreprise (calculés par le serveur) et montant disponible au retrait. */
export type AdminFinanceSummary = {
  currency: string;
  sources: { key: string; label: string; total: number; thisMonth: number }[];
  total: number;
  thisMonth: number;
  months: { month: string; total: number }[];
  withdrawn: number;
  pendingWithdrawals: number;
  paidWithdrawals: number;
  available: number;
  minWithdrawal: number;
};

/** Commission de l'entreprise sur une course ou une livraison terminée. */
export type AdminCommissionRow = {
  kind: "RIDE" | "DELIVERY" | "PERSONAL";
  id: string;
  ref: string;
  date: string;
  who: string | null;
  vehicle: string | null;
  amount: number;
  commission: number;
  pct: number;
};

export type AdminCompanyWithdrawal = {
  id: string;
  amount: number;
  phone: string;
  method: string | null;
  note: string | null;
  status: "REQUESTED" | "PAID" | "CANCELLED";
  reference: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type AdminUserItem = {
  id: string;
  phone: string;
  fullName: string | null;
  role: string;
  status: "ACTIVE" | "PENDING_VALIDATION" | "BLOCKED";
  createdAt: string;
  wallet?: { balance: number } | null;
  provider?: { id: string; type: ProviderType; status: ProviderStatus; kycScore: number } | null;
  agency?: { id: string; name: string; plan: string } | null;
};

export type AdminAuditEvent = {
  id: string;
  type: string;
  comment: string | null;
  actorId: string | null;
  createdAt: string;
  provider: {
    id: string;
    type: ProviderType;
    name: string;
    phone: string;
  };
};

export const adminApi = {
  stats: () => api.get<AdminGlobalStats>(`${P}/admin/stats`),
  users: (params: { q?: string; role?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.role) qs.set("role", params.role);
    const query = qs.toString();
    return api.get<AdminUserItem[]>(`${P}/admin/users${query ? `?${query}` : ""}`);
  },
  setUserStatus: (userId: string, status: "ACTIVE" | "BLOCKED", reason?: string) =>
    api.post<AdminUserItem>(`${P}/admin/users/${userId}/status`, {
      status,
      ...(reason ? { reason } : {}),
    }),
  auditLog: () => api.get<AdminAuditEvent[]>(`${P}/admin/audit-log`),
  /** Finances de l'entreprise : gains par source et par mois, retraits, disponible. */
  financeSummary: () => api.get<AdminFinanceSummary>(`${P}/admin/finance`),
  withdrawals: () => api.get<AdminCompanyWithdrawal[]>(`${P}/admin/finance/withdrawals`),
  /** Commission prélevée sur chaque course et livraison (montant, pourcentage, somme). */
  commissions: (limit = 50) => api.get<AdminCommissionRow[]>(`${P}/admin/finance/commissions?limit=${limit}`),
  requestWithdrawal: (body: { amount: number; phone: string; method?: string; note?: string }) =>
    api.post<AdminCompanyWithdrawal>(`${P}/admin/finance/withdrawals`, body),
  markWithdrawalPaid: (id: string, reference?: string) =>
    api.post<AdminCompanyWithdrawal>(`${P}/admin/finance/withdrawals/${id}/paid`, { ...(reference ? { reference } : {}) }),
  cancelWithdrawal: (id: string) => api.post<AdminCompanyWithdrawal>(`${P}/admin/finance/withdrawals/${id}/cancel`),
};

/* ---- Console administrateur (validation des dossiers) ---- */

export type AdminProviderItem = ProviderDossier & {
  user: {
    id: string;
    phone: string;
    fullName: string | null;
    role: string;
    status: string;
    createdAt: string;
  };
};

export type AdminProviderQueue = {
  items: AdminProviderItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  counts: Record<string, number>;
};

export type AdminProviderDetail = AdminProviderItem & {
  agency: { id: string; name: string; plan: string; commissionRate: number; maxAccounts: number } | null;
  timeline: ProviderTimelineEntry[];
};

export type AdminProviderStats = {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  pending: number;
  overdue: number;
  slaHours: number;
  averageReviewHours: number | null;
  approved: number;
  suspended: number;
};

export type ProviderDecision = "APPROVE" | "REJECT" | "NEED_INFO" | "SUSPEND";

export const adminProvidersApi = {
  queue: (params: { status?: ProviderStatus; type?: ProviderType; city?: string; page?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.type) q.set("type", params.type);
    if (params.city) q.set("city", params.city);
    if (params.page) q.set("page", String(params.page));
    const qs = q.toString();
    return api.get<AdminProviderQueue>(`${P}/admin/providers${qs ? `?${qs}` : ""}`);
  },
  stats: () => api.get<AdminProviderStats>(`${P}/admin/providers/stats`),
  detail: (id: string) => api.get<AdminProviderDetail>(`${P}/admin/providers/${id}`),
  startReview: (id: string) => api.post<AdminProviderDetail>(`${P}/admin/providers/${id}/start-review`),
  decideDocument: (id: string, documentId: string, decision: "VALID" | "INVALID", note?: string) =>
    api.post<ProviderDocumentView>(`${P}/admin/providers/${id}/documents/${documentId}/decision`, {
      decision,
      ...(note ? { note } : {}),
    }),
  decide: (id: string, decision: ProviderDecision, reason?: string, overrideDocuments?: boolean) =>
    api.post<ProviderDossier>(`${P}/admin/providers/${id}/decision`, {
      decision,
      ...(reason ? { reason } : {}),
      ...(overrideDocuments ? { overrideDocuments: true } : {}),
    }),
  reinstate: (id: string) => api.post<ProviderDossier>(`${P}/admin/providers/${id}/reinstate`),
};
