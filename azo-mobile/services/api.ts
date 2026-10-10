// Client HTTP de l'app AZƆ̀ : parle au backend NestJS.
//
// ⚠️ IMPORTANT : mets l'IP de TON ordinateur dans azo-mobile/.env (EXPO_PUBLIC_API_URL).
// (commande : hostname -I  -> prends la première, ex. 192.168.1.23).
// "localhost" ne marche PAS depuis un téléphone : pour lui, localhost = le téléphone lui-même.
//   - Téléphone réel (Expo Go)  : http://192.168.x.x:3000
//   - Émulateur Android         : http://10.0.2.2:3000
//   - Navigateur (expo web)     : http://localhost:3000

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

export const errorMessage = (e: unknown) =>
  friendlyApiMessage(e instanceof Error ? e.message : "Une erreur est survenue.");

async function request<T>(
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
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...((options.headers as Record<string, string>) ?? {}),
      },
      signal: controller.signal,
    });

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
  post: <T>(path: string, body?: unknown, opts?: { timeoutMs?: number }) =>
    request<T>(path, { method: "POST", body: json(body), ...opts }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: json(body) }),
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
    const r = await api.post<{ token: string; user: UserProfile; provider: ProviderRef | null }>("/auth/verify-otp", {
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
  role: string;
  status?: "ACTIVE" | "PENDING_VALIDATION" | "BLOCKED";
  createdAt?: string;
};

export const userApi = {
  me: () => api.get<UserProfile>("/users/me"),
  update: (fullName: string) => api.patch<UserProfile>("/users/me", { fullName }),
};

/* ==================== PORTEFEUILLE AZƆ̀ PAY ==================== */

export type WalletTransaction = {
  id: string;
  type: "CREDIT" | "DEBIT";
  amount: number;
  label: string;
  meta: string | null;
  createdAt: string;
};

export const walletApi = {
  get: () => api.get<{ balance: number; cashback: number }>("/wallet"),
  transactions: () => api.get<WalletTransaction[]>("/wallet/transactions"),
  // ⚠️ Simulation côté backend : le vrai paiement (FedaPay / KKiaPay) reste à brancher.
  recharge: (amount: number, method: string) =>
    api.post<{ balance: number }>("/wallet/recharge", { amount, method }),
};

/* ==================== CARTES / ADRESSES ==================== */

export type Place = { id?: string; title: string; subtitle?: string; latitude: number; longitude: number };

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

/* ==================== COURSES (ZEM ESSENCE / ZEM ÉLECTRIQUE / VOITURE) ==================== */

/**
 * Véhicules AZƆ̀ (barème tarifaire), en deux filières distinctes :
 *   * ZEM_ESSENCE / ZEM_ELECTRIC → les motos-taxis (Zem), facturés au même tarif ;
 *   * GAZELLE / KOALA / LEOPARD  → les voitures proposées pour une course.
 * Les anciens types ZEM / CAR ne sont plus proposés : les courses passées sont
 * rattachées à un véhicule (ZEM → ZEM_ESSENCE ; CAR → KOALA) via `services/tarification`.
 */
export type VehicleType = "ZEM_ESSENCE" | "ZEM_ELECTRIC" | "GAZELLE" | "KOALA" | "LEOPARD";

/** Filière d'un véhicule : moto-taxi (Zem) ou voiture. */
export type VehicleFamily = "ZEM" | "CAR";
export type RideStatus = "PENDING" | "MATCHED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

// ⚠️ N'ajoute AUCUN autre champ : le backend refuse les champs inconnus.
export type RideRequest = {
  originLat: number; originLng: number; destLat: number; destLng: number; vehicleType: VehicleType;
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

export type RidePerson = { fullName?: string | null; phone?: string };

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
  /** Visible uniquement au client lorsque le chauffeur a signalé son arrivée. */
  pickupCode?: string | null;
  /** Visible uniquement au client pendant IN_PROGRESS, à saisir pour terminer la course. */
  dropCode?: string | null;
  driverArrivedAt?: string | null;
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

export const ridesApi = {
  /* --- Client --- */
  estimate: (body: RideRequest) => api.post<Estimate>(`${P}/rides/estimate`, body),
  create: (body: RideRequest) => api.post<Ride>(`${P}/rides`, body),
  get: (id: string) => api.get<Ride>(`${P}/rides/${id}`, { timeoutMs: 8000 }),
  history: () => api.get<Ride[]>(`${P}/rides/history`),
  rate: (rideId: string, stars: number) => api.post<Ride>(`${P}/rides/${rideId}/rate`, { stars }),
  cancel: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/cancel`),

  /* --- Conducteur --- */
  /** Radar du chauffeur : sa position est transmise pour filtrer et classer par proximité. */
  pending: (position?: { latitude: number; longitude: number }) =>
    api.get<Ride[]>(
      `${P}/rides/pending` +
        (position
          ? `?lat=${encodeURIComponent(position.latitude)}&lng=${encodeURIComponent(position.longitude)}`
          : "")
    ),
  accept: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/accept`),
  arrive: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/arrive`),
  start: (rideId: string, pin: string) => api.post<Ride>(`${P}/rides/${rideId}/start`, { pin }),
  complete: (rideId: string, pin: string) =>
    api.post<Ride>(`${P}/rides/${rideId}/complete`, { pin }),

  /* --- Messagerie sécurisée in-app --- */
  messages: (rideId: string) => api.get<RideChatMessage[]>(`${P}/rides/${rideId}/messages`),
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
  client?: RidePerson | null;
  courier?: RidePerson | null;
};

export const deliveryApi = {
  /* --- Client --- */
  create: (body: {
    packageType: string;
    pickupAddress: string;
    dropAddress: string;
    payer: "SENDER" | "RECIPIENT";
    price: number;
  }) => api.post<Delivery>(`${P}/deliveries`, body),
  mine: () => api.get<Delivery[]>(`${P}/deliveries`),
  cancel: (id: string) => api.post<Delivery>(`${P}/deliveries/${id}/cancel`),

  /* --- Coursier / Livreur --- */
  pending: () => api.get<Delivery[]>(`${P}/deliveries/pending`),
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

export const rentalApi = {
  catalog: () => api.get<{ id: string; name: string; pricePerDay: number; seats: number }[]>(`${P}/rentals/catalog`),
  book: (body: { vehicleModel: string; formula: string; pricePerDay: number }) =>
    api.post<RentalBooking>(`${P}/rentals`, body),
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
  | "PHOTO_VEHICULE" | "RCCM" | "IFU" | "STATUTS" | "DIPLOME" | "EXTRAIT_CASIER";
export type DocumentReview = "PENDING" | "VALID" | "INVALID";
export type AgencyPlanChoice = "PRO" | "SILVER" | "OR" | "DIAMANT";

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
  roster: AgencyRosterMember[];
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
