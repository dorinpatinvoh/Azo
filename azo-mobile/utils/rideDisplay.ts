import { MaterialIcons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { Ride, RideStatus, VehicleType } from "../services/api";

export const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F`;

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  ZEM: "Zem",
  ZEM_ELECTRIC: "Zem électrique",
  CAR: "Voiture",
};

export const VEHICLE_ICON: Record<VehicleType, keyof typeof MaterialIcons.glyphMap> = {
  ZEM: "two-wheeler",
  ZEM_ELECTRIC: "electric-moped",
  CAR: "directions-car",
};

export const STATUS_INFO: Record<RideStatus, { label: string; color: string; bg: string }> = {
  PENDING: { label: "Recherche d'un conducteur…", color: colors.tertiary, bg: colors.tertiaryFixed },
  MATCHED: { label: "Conducteur en route", color: colors.primary, bg: colors.primaryFixed },
  IN_PROGRESS: { label: "Course en cours", color: colors.secondary, bg: colors.secondaryFixed },
  COMPLETED: { label: "Terminée", color: colors.onSurfaceVariant, bg: colors.surfaceContainer },
  CANCELLED: { label: "Annulée", color: colors.error, bg: colors.errorContainer },
};

export const ACTIVE_STATUSES: RideStatus[] = ["PENDING", "MATCHED", "IN_PROGRESS"];

export function relativeDay(iso: string) {
  const d = new Date(iso);
  const t = new Date();
  const diff = Math.round(
    (new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000
  );
  const hour = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `Aujourd'hui, ${hour}`;
  if (diff === 1) return `Hier, ${hour}`;
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}, ${hour}`;
}

// --- Données de démonstration (serveur injoignable) -------------------------
const daysAgo = (n: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

export const DEMO_RIDES: Ride[] = [
  { id: "demo-1", clientId: "demo", driverId: "demo-driver", status: "IN_PROGRESS", vehicleType: "ZEM", originLat: 6.3579, originLng: 2.4263, destLat: 6.3669, destLng: 2.4326, price: 650, rating: null, createdAt: daysAgo(0, 9) },
  { id: "demo-2", clientId: "demo", driverId: "demo-driver", status: "COMPLETED", vehicleType: "CAR", originLat: 6.3654, originLng: 2.4181, destLat: 6.3721, destLng: 2.4391, price: 2500, rating: 5, createdAt: daysAgo(1) },
  { id: "demo-3", clientId: "demo", driverId: "demo-driver", status: "COMPLETED", vehicleType: "ZEM_ELECTRIC", originLat: 6.3489, originLng: 2.4341, destLat: 6.3612, destLng: 2.4222, price: 900, rating: 4, createdAt: daysAgo(2) },
  { id: "demo-4", clientId: "demo", driverId: "demo-driver", status: "COMPLETED", vehicleType: "ZEM", originLat: 6.3701, originLng: 2.4288, destLat: 6.3542, destLng: 2.4109, price: 700, rating: 5, createdAt: daysAgo(4) },
  { id: "demo-5", clientId: "demo", driverId: null, status: "CANCELLED", vehicleType: "ZEM", originLat: 6.3602, originLng: 2.4193, destLat: 6.3666, destLng: 2.4402, price: 600, rating: null, createdAt: daysAgo(5) },
  { id: "demo-6", clientId: "demo", driverId: "demo-driver", status: "COMPLETED", vehicleType: "CAR", originLat: 6.3521, originLng: 2.4471, destLat: 6.3790, destLng: 2.4180, price: 3200, rating: 5, createdAt: daysAgo(6) },
];
export const DEMO_BALANCE = 18500;
export const DEMO_CASHBACK = 420;
export const DEMO_UNREAD = 2;
export const DEMO_USER = { id: "demo", phone: "97000042", fullName: "Kossi Adjovi", role: "CLIENT", createdAt: daysAgo(90) };
