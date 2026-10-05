/**
 * Tarification AZƆ̀ côté application.
 *
 * Le barème vient de la configuration partagée (`config/tarification.json`,
 * synchronisée avec le backend) et, quand le serveur est joignable, de la route
 * publique `GET /pricing` — l'app affiche donc exactement les mêmes prix que le
 * backend. Aucun tarif n'est codé en dur ici.
 */
import { api } from "./api";
import reference from "../config/tarification.json";

export type VehicleGamme = "GAZELLE" | "KOALA" | "LEOPARD";
/** Les types historiques restent acceptés (anciennes courses en base). */
export type VehicleKey = VehicleGamme | "ZEM" | "ZEM_ELECTRIC" | "CAR";
export type AgencyLevel = "PRO" | "SILVER" | "OR" | "DIAMANT";

export type VehiclePricing = {
  base: number;
  perKmUpTo15: number;
  perKmFrom16: number;
  airConditioned?: boolean;
};

export type AgencyLevelPricing = {
  activationFee: number;
  commissionPct: number;
  withdrawalFeePct: number;
  maxAccounts: number;
};

export type TarificationConfig = {
  currency: string;
  kmThreshold: number;
  vehicles: Record<VehicleGamme, VehiclePricing>;
  agencyLevels: Record<AgencyLevel, AgencyLevelPricing>;
  profiles: Record<string, { category?: string; monthlyRevenueSharePct?: number; withdrawalFeePct?: number }>;
  legacyVehicleMapping: Record<string, VehicleGamme>;
  agencyActivation: { requiredForOperations: boolean };
};

let current: TarificationConfig = reference as unknown as TarificationConfig;

export function tarification(): TarificationConfig {
  return current;
}

/** Gammes de véhicules proposées au client (ordre d'affichage). */
export function vehicleGammes(): VehicleGamme[] {
  return Object.keys(current.vehicles) as VehicleGamme[];
}

export function resolveGamme(vehicle: VehicleKey | string): VehicleGamme {
  const key = String(vehicle || "").toUpperCase();
  if (key in current.vehicles) return key as VehicleGamme;
  const mapped = current.legacyVehicleMapping?.[key];
  if (mapped) return mapped;
  return "GAZELLE";
}

export function vehicleLabel(vehicle: VehicleKey | string): string {
  const gamme = resolveGamme(vehicle);
  return current.vehicles[gamme]?.airConditioned ? `${gamme} · climatisé` : gamme;
}

/** Prix d'une course = tarif de base + coût kilométrique par tranche (FCFA entiers). */
export function ridePrice(distanceKm: number, vehicle: VehicleKey | string): number {
  const gamme = resolveGamme(vehicle);
  const pricing = current.vehicles[gamme];
  const threshold = current.kmThreshold;
  const mmPerKm = 1000;
  const kmMm = Math.round(Math.max(distanceKm, 0) * mmPerKm);
  const thresholdMm = Math.round(threshold * mmPerKm);
  const firstMm = Math.min(kmMm, thresholdMm);
  const secondMm = Math.max(kmMm - thresholdMm, 0);
  return (
    pricing.base +
    Math.floor((firstMm * pricing.perKmUpTo15) / mmPerKm) +
    Math.floor((secondMm * pricing.perKmFrom16) / mmPerKm)
  );
}

/* ------------------------------------------------------------------ Agences */

export function agencyLevelPricing(level: AgencyLevel): AgencyLevelPricing {
  return current.agencyLevels[level] ?? current.agencyLevels.PRO;
}

export function agencyCommission(level: AgencyLevel, amount: number): number {
  return Math.floor((amount * agencyLevelPricing(level).commissionPct) / 100);
}

export function agencyWithdrawalFee(level: AgencyLevel, amount: number): number {
  return Math.floor((amount * agencyLevelPricing(level).withdrawalFeePct) / 100);
}

/** Une agence n'opère qu'une fois les frais d'activation (uniques) réglés. */
export function agencyCanOperate(agency: { plan?: AgencyLevel; feePaidAt?: string | null }): boolean {
  if (!current.agencyActivation?.requiredForOperations) return true;
  return !!agency.feePaidAt;
}

export function agencyRemainingAccounts(level: AgencyLevel, currentAccounts: number): number {
  return Math.max(agencyLevelPricing(level).maxAccounts - currentAccounts, 0);
}

/* ------------------------------------------------------------------ Profils */

export function profileCategory(profile: string): string | null {
  return current.profiles?.[profile.toUpperCase()]?.category ?? null;
}

export function withdrawalFeePct(profile: string | null, agencyLevel: AgencyLevel | null): number {
  const fromProfile = profile ? current.profiles?.[profile.toUpperCase()]?.withdrawalFeePct : undefined;
  if (typeof fromProfile === "number") return fromProfile;
  if (agencyLevel) return agencyLevelPricing(agencyLevel).withdrawalFeePct;
  return 0;
}

/* -------------------------------------------------------------- Synchronisation */

/**
 * Récupère le barème officiel du serveur (route publique `GET /pricing`).
 * En cas d'échec (hors ligne), la copie embarquée synchronisée
 * (`config/tarification.json`) reste utilisée : jamais de prix inventé.
 */
export async function refreshTarification(): Promise<TarificationConfig> {
  try {
    const res = await api.get<{ config: TarificationConfig }>("/pricing");
    if (res?.config?.vehicles) current = cleanse(res.config);
  } catch {
    // serveur injoignable : barème embarqué conservé
  }
  return current;
}

/** Ne garde que les clés métier connues (protège d'un cache obsolète). */
function cleanse(config: TarificationConfig): TarificationConfig {
  return {
    currency: config.currency ?? reference.currency,
    kmThreshold: config.kmThreshold ?? reference.kmThreshold,
    vehicles: config.vehicles ?? (reference as unknown as TarificationConfig).vehicles,
    agencyLevels: config.agencyLevels ?? (reference as unknown as TarificationConfig).agencyLevels,
    profiles: config.profiles ?? {},
    legacyVehicleMapping: config.legacyVehicleMapping ?? {},
    agencyActivation: config.agencyActivation ?? { requiredForOperations: true },
  };
}
