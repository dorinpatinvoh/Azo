// Client HTTP de l'app AZƆ̀ : parle au backend NestJS.
//
// ⚠️ IMPORTANT : mets l'IP de TON ordinateur dans azo-mobile/.env (EXPO_PUBLIC_API_URL).
// (commande : hostname -I  -> prends la première, ex. 192.168.1.23).
// "localhost" ne marche PAS depuis un téléphone : pour lui, localhost = le téléphone lui-même.
//   - Téléphone réel (Expo Go)  : http://192.168.x.x:3000
//   - Émulateur Android         : http://10.0.2.2:3000
//   - Navigateur (expo web)     : http://localhost:3000

export const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://192.168.100.10:3000";

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
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: json(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: json(body) }),
};

/** Envoi d'un fichier (photo de pièce d'identité, selfie…). Délai plus long qu'un appel JSON. */
async function upload<T>(path: string, form: FormData, timeoutMs = 90000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      // Pas de Content-Type : React Native pose la frontière multipart tout seul.
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
      signal: controller.signal,
    });
    return await handleResponse<T>(res);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error)?.name === "AbortError")
      throw new ApiError("L'envoi de la photo prend trop de temps. Réessaie avec une meilleure connexion.", 0);
    throw new ApiError("Impossible d'envoyer la photo. Vérifie ta connexion.", 0);
  } finally {
    clearTimeout(timer);
  }
}

/* ==================== AUTHENTIFICATION (SMS OTP) ==================== */

export type ProfileRole = "CLIENT" | "DRIVER" | "AGENCY";

export const authApi = {
  requestOtp: (phone: string) => api.post<{ message: string; phone: string }>("/auth/request-otp", { phone }),
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

/* ==================== COURSES (ZEM / ZEM ÉLECTRIQUE / VOITURE) ==================== */

export type VehicleType = "ZEM" | "ZEM_ELECTRIC" | "CAR";
export type RideStatus = "PENDING" | "MATCHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

// ⚠️ N'ajoute AUCUN autre champ : le backend refuse les champs inconnus.
export type RideRequest = {
  originLat: number; originLng: number; destLat: number; destLng: number; vehicleType: VehicleType;
};

export type Estimate = {
  distanceKm: number;
  etaMinutes: number;
  price: number;
  // Fournis par le calcul détaillé (backend geo.ts) ; absents du tarif forfaitaire actuel.
  durationMin?: number;
  breakdown?: { label?: string; km: number; perKm: number }[];
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
  createdAt: string;
  driver?: RidePerson | null;
  client?: RidePerson | null;
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
  pending: () => api.get<Ride[]>(`${P}/rides/pending`),
  accept: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/accept`),
  start: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/start`),
  complete: (rideId: string) => api.post<Ride>(`${P}/rides/${rideId}/complete`),
};

// Alias historique : les écrans plus anciens importent `rideApi`.
export const rideApi = ridesApi;

/* ==================== LIVRAISON DE COLIS ==================== */

export type Delivery = {
  id: string;
  status: string;
  packageType: string;
  pickupAddress: string;
  dropAddress: string;
  payer: "SENDER" | "RECIPIENT";
  price: number;
  pickupCode: string;
  deliveryCode: string;
  createdAt: string;
};

export const deliveryApi = {
  create: (body: {
    packageType: string;
    pickupAddress: string;
    dropAddress: string;
    payer: "SENDER" | "RECIPIENT";
    price: number;
  }) => api.post<Delivery>(`${P}/deliveries`, body),
  mine: () => api.get<Delivery[]>(`${P}/deliveries`),
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
};

/* ============ PRESTATAIRES : dossier, pièces, validation admin ============ */

export type ProviderType = "DRIVER" | "AGENCY" | "ARTISAN" | "COURIER";
export type ProviderStatus =
  | "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "NEED_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type DocumentKind =
  | "CNI" | "SELFIE" | "PERMIS" | "CARTE_GRISE" | "ASSURANCE" | "VISITE_TECHNIQUE"
  | "PHOTO_VEHICULE" | "RCCM" | "IFU" | "STATUTS" | "DIPLOME" | "EXTRAIT_CASIER";
export type DocumentReview = "PENDING" | "VALID" | "INVALID";
export type AgencyPlanChoice = "PRO" | "ARGENT" | "OR" | "DIAMANT";

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
    vehicleChoices: { value: VehicleType; label: string; hint: string }[];
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
};

/** Fichier choisi sur le téléphone (expo-image-picker). */
export type PickedFile = { uri: string; name: string; type: string };

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
  /** Dépôt de la photo d'une pièce. */
  uploadDocument: (id: string, kind: DocumentKind, file: PickedFile) => {
    const form = new FormData();
    // React Native accepte { uri, name, type } comme corps de fichier.
    form.append("file", file as unknown as Blob);
    return upload<ProviderDocumentView>(`${P}/providers/applications/${id}/documents/${kind}/file`, form);
  },
  submit: (id: string) => api.post<ProviderDossier>(`${P}/providers/applications/${id}/submit`),
  /** Source prête pour <Image> : la pièce est protégée, l'en-tête Authorization est requis. */
  fileSource: (documentId: string) => ({
    uri: `${API_URL}${P}/providers/documents/${documentId}/file`,
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
  }),
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
