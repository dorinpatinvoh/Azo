import { MaterialIcons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { Ride, RideStatus, VehicleType } from "../services/api";
import { getLanguage, languageInfo, tr, type MessageKey } from "../i18n";

// Langue courante de l'application (choisie à l'accueil ou dans le profil)
const numLocale = () => languageInfo(getLanguage()).locale;

export const fcfa = (n: number) => `${n.toLocaleString(numLocale())} F`;

// Libellés courts d'un véhicule : les deux Speeder (motos-taxis) puis les trois voitures.
// Lus à chaque accès (accesseurs) : ils suivent la langue choisie sans changer les appels existants.
export const VEHICLE_LABEL = {} as Record<VehicleType, string>;
(["ZEM_ESSENCE", "ZEM_ELECTRIC", "ZEM_TRICYCLE", "GAZELLE", "KOALA", "LEOPARD"] as VehicleType[]).forEach((v) => {
  const key = (v.startsWith("ZEM_") ? `veh.${v}.label` : `live.vehicle.${v}`) as MessageKey;
  Object.defineProperty(VEHICLE_LABEL, v, { enumerable: true, get: () => tr(key) });
});

export const VEHICLE_ICON: Record<VehicleType, keyof typeof MaterialIcons.glyphMap> = {
  ZEM_ESSENCE: "two-wheeler",
  ZEM_ELECTRIC: "electric-moped",
  ZEM_TRICYCLE: "electric-rickshaw",
  GAZELLE: "directions-car",
  KOALA: "directions-car",
  LEOPARD: "local-taxi",
};

const statusInfo = (status: RideStatus, color: string, bg: string) => ({
  get label() { return tr(`rd.status.${status}` as MessageKey); },
  color,
  bg,
});
export const STATUS_INFO: Record<RideStatus, { label: string; color: string; bg: string }> = {
  PENDING: statusInfo("PENDING", colors.tertiary, colors.tertiaryFixed),
  OFFERED: statusInfo("OFFERED", colors.tertiary, colors.tertiaryFixed),
  MATCHED: statusInfo("MATCHED", colors.primary, colors.primaryFixed),
  ARRIVED: statusInfo("ARRIVED", colors.primary, colors.primaryFixed),
  IN_PROGRESS: statusInfo("IN_PROGRESS", colors.secondary, colors.secondaryFixed),
  COMPLETED: statusInfo("COMPLETED", colors.onSurfaceVariant, colors.surfaceContainer),
  CANCELLED: statusInfo("CANCELLED", colors.error, colors.errorContainer),
};

export const ACTIVE_STATUSES: RideStatus[] = ["PENDING", "OFFERED", "MATCHED", "ARRIVED", "IN_PROGRESS"];

export function relativeDay(iso: string) {
  const d = new Date(iso);
  const t = new Date();
  const diff = Math.round(
    (new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000
  );
  const locale = numLocale();
  const hour = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return tr("rd.today", { hour });
  if (diff === 1) return tr("rd.yesterday", { hour });
  return `${d.toLocaleDateString(locale, { day: "numeric", month: "short" })}, ${hour}`;
}

// --- Données de démonstration (serveur injoignable) -------------------------
const daysAgo = (n: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

export const DEMO_RIDES: Ride[] = [
  { id: "demo-1", clientId: "demo", driverId: "demo-driver", status: "COMPLETED", vehicleType: "GAZELLE", originLat: 6.3579, originLng: 2.3912, destLat: 6.3541, destLng: 2.4352, price: 2800, rating: 5, createdAt: daysAgo(0, 9), driver: { fullName: "Romaric Soglo", phone: "" } },
  { id: "demo-2", clientId: "demo", driverId: "demo-driver", status: "COMPLETED", vehicleType: "KOALA", originLat: 6.3572, originLng: 2.3844, destLat: 6.3511, destLng: 2.4125, price: 4950, rating: 5, createdAt: daysAgo(1), driver: { fullName: "Ulrich Houngbédji", phone: "" } },
  { id: "demo-3", clientId: "demo", driverId: "demo-driver", status: "COMPLETED", vehicleType: "ZEM_ELECTRIC", originLat: 6.3654, originLng: 2.4181, destLat: 6.3721, destLng: 2.4391, price: 1600, rating: 5, createdAt: daysAgo(2), driver: { fullName: "Coffi Narcisse Dossou", phone: "" } },
  { id: "demo-4", clientId: "demo", driverId: "demo-driver", status: "COMPLETED", vehicleType: "ZEM_ESSENCE", originLat: 6.3701, originLng: 2.4288, destLat: 6.3542, destLng: 2.4109, price: 1300, rating: 5, createdAt: daysAgo(4), driver: { fullName: "Romaric Soglo", phone: "" } },
];
export const DEMO_BALANCE = 48500;
export const DEMO_CASHBACK = 1250;
export const DEMO_UNREAD = 2;
export const DEMO_USER = { id: "demo", phone: "", fullName: "Kossi Boris Adjovi", role: "CLIENT", createdAt: daysAgo(90) };
