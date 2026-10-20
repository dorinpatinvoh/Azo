// Formes des réponses de l'API d'administration (voir le serveur : admin, providers, support, rental, users, referrals).

export type ProviderType = "DRIVER" | "COURIER" | "AGENCY" | "ARTISAN";
export type ProviderStatus = "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "NEED_INFO" | "APPROVED" | "REJECTED" | "SUSPENDED";

export type ProviderDocument = {
  id: string;
  kind: string;
  label: string;
  status: "PENDING" | "VALID" | "INVALID";
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

export type ProviderItem = {
  id: string;
  type: ProviderType;
  typeLabel: string;
  status: ProviderStatus;
  identity: { fullName: string | null; city: string | null; zones: string[]; bio: string | null; experienceYears: number | null };
  activity: {
    vehicleType: string | null;
    vehicleModel: string | null;
    plateNumber: string | null;
    categoryId: string | null;
    agencyName: string | null;
    plan: string | null;
    planLabel: string | null;
    planFee: number | null;
    planCommissionRate: number | null;
    agencyDetails?: AgencyDetails | null;
  };
  review: {
    submittedAt: string | null;
    reviewedAt: string | null;
    rejectReason: string | null;
    suspensionReason: string | null;
    infoRequested: string | null;
    waitingHours: number | null;
    slaHours: number;
    overdue: boolean;
  };
  activation: { activatedAt: string | null; rating: number; jobsCompleted: number; kycScore: number };
  documents: ProviderDocument[];
  missingDocuments: { kind: string; label: string }[];
  missingFields: string[];
  createdAt: string;
  updatedAt: string;
  user: { id: string; phone: string; fullName: string | null; role: string; status: string; createdAt: string };
};

export type ProviderDetail = ProviderItem & {
  agency: { id: string; name: string; plan: string; commissionRate: number; maxAccounts: number } | null;
  timeline: { id: string; type: string; comment: string | null; byAdmin?: boolean; createdAt: string }[];
};

export type ProviderQueue = { items: ProviderItem[]; total: number; page: number; perPage: number; pages: number; counts: Record<string, number> };

export type ProviderStats = {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  pending: number;
  overdue: number;
  slaHours: number;
  averageReviewHours: number | null;
  approved: number;
  suspended: number;
};

export type GlobalStats = {
  users: number;
  rides: number;
  completedRides: number;
  deliveries: number;
  completedDeliveries: number;
  commissionsRevenue: number;
  agencies: number;
  providersPending: number;
  providersApproved: number;
  blockedUsers: number;
};

export type UserRow = {
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

export type AuditEvent = {
  id: string;
  type: string;
  comment: string | null;
  actorId: string | null;
  createdAt: string;
  provider: { id: string; type: ProviderType; name: string; phone: string };
};

export type FinanceSummary = {
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

export type CommissionRow = {
  kind: "RIDE" | "DELIVERY" | "PERSONAL";
  id: string;
  ref: string;
  date: string;
  who: string | null;
  vehicle: string | null;
  amount: number;
  commission: number;
  pct: number;
  driverName?: string | null;
  driverPhone?: string | null;
  agencyName?: string | null;
  independent?: boolean;
  clientName?: string | null;
  clientPhone?: string | null;
  origin?: string | null;
  dest?: string | null;
  distanceKm?: number | null;
};

export type Withdrawal = {
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

export type ReferralKind = "SPEEDER" | "AGENCE" | "COURSIER_PERSONNEL" | "LIVREUR_EXPRESS";
export type ReferralStatus = "ACTIF" | "INACTIF" | "EN_ATTENTE" | "REFUSE" | "SUSPENDU";
export type KindSummary = { total: number; enAttente: number; actifs: number; inactifs: number; autres: number; ontRecharge: number; montantRecharge: number };
export type ReferralItem = {
  userId: string;
  name: string;
  phone: string;
  kind: ReferralKind | null;
  status: ReferralStatus;
  providerStatus: string | null;
  city: string | null;
  vehicleType: string | null;
  agencyName: string | null;
  fleetSize: number | null;
  referredAt: string | null;
  registeredAt: string;
  approvedAt: string | null;
  lastActivityAt: string | null;
  jobsTotal: number;
  jobsLast30Days: number;
  recharged: boolean;
  rechargeCount: number;
  rechargedTotal: number;
  lastRechargeAt: string | null;
};
export type ReferralOverview = {
  summary: { activeWindowDays: number; byKind: Record<ReferralKind, KindSummary>; totals: KindSummary; unclassified: number };
  referrals: ReferralItem[];
};
export type CommercialRow = {
  id: string;
  code: string;
  link: string;
  active: boolean;
  note: string | null;
  fullName: string | null;
  phone: string;
  createdAt: string;
  totals: KindSummary;
  byKind: Record<ReferralKind, KindSummary>;
};
export type CommercialDetail = ReferralOverview & {
  referrer: { id: string; code: string; link: string; active: boolean; note: string | null; fullName: string | null; phone: string; createdAt: string };
};

export type TicketRow = {
  id: string;
  category: string;
  subject: string;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  rideId: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { fullName: string | null; phone: string; role: string };
  lastMessage?: { authorRole: string; text: string; createdAt: string } | null;
};
export type TicketDetail = {
  id: string;
  category: string;
  subject: string;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  rideId: string | null;
  createdAt: string;
  updatedAt: string;
  user: { fullName: string | null; phone: string; role: string };
  messages: { id: string; authorRole: "USER" | "ADMIN"; text: string; createdAt: string }[];
};

export type IdentityCorrection = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  gender: string | null;
  reason: string;
  createdAt: string;
  user: { firstName: string | null; lastName: string | null; gender: string | null; phone: string };
};

export type RentalVehicle = {
  id: string;
  name: string;
  seats: number;
  pricePerDay: number;
  price4h: number | null;
  priceWeek: number | null;
  active: boolean;
  createdAt: string;
};
