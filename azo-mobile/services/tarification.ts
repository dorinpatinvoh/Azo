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

/** Filière du véhicule : moto-taxi (Zem) ou voiture. */
export type VehicleFamily = "ZEM" | "CAR";

/** Véhicules facturables : les deux Zem (motos-taxis) puis les voitures. */
export type VehicleKey = "ZEM_ESSENCE" | "ZEM_ELECTRIC" | "GAZELLE" | "KOALA" | "LEOPARD";

/** Les types historiques restent acceptés (anciennes courses en base). */
export type LegacyVehicleKey = "ZEM" | "CAR";
export type AgencyLevel = "PRO" | "SILVER" | "OR" | "DIAMANT";

/** Palier kilométrique : `upToKm` inclus, `null` pour le dernier palier (illimité). */
export type VehicleBracket = { upToKm: number | null; perKm: number };

/** Remise sur la base appliquée au-delà d'une distance (Zem : −25 % après 10 km). */
export type BaseDiscount = { pct: number; aboveKm: number };

export type VehiclePricing = {
  base: number;
  /** Paliers kilométriques, du premier au dernier (dernier = illimité). */
  brackets: VehicleBracket[];
  baseDiscount?: BaseDiscount;
  airConditioned?: boolean;
  family?: VehicleFamily;
};

export type AgencyLevelPricing = {
  activationFee: number;
  commissionPct: number;
  withdrawalFeePct: number;
  maxAccounts: number;
};

export type TarificationConfig = {
  currency: string;
  vehicles: Record<VehicleKey, VehiclePricing>;
  agencyLevels: Record<AgencyLevel, AgencyLevelPricing>;
  profiles: Record<string, { category?: string; monthlyRevenueSharePct?: number; withdrawalFeePct?: number }>;
  legacyVehicleMapping: Record<string, VehicleKey>;
  agencyActivation: { requiredForOperations: boolean };
};

let current: TarificationConfig = reference as unknown as TarificationConfig;

export function tarification(): TarificationConfig {
  return current;
}

/** Les deux types de Zem (motos-taxis), proposés à l'étape 1 de la commande. */
export const ZEM_VEHICLES: VehicleKey[] = ["ZEM_ESSENCE", "ZEM_ELECTRIC"];

/** Les trois voitures. */
export const CAR_VEHICLES: VehicleKey[] = ["GAZELLE", "KOALA", "LEOPARD"];

export function resolveVehicleKey(vehicle: VehicleKey | string): VehicleKey {
  const key = String(vehicle || "").toUpperCase();
  if (key in current.vehicles) return key as VehicleKey;
  const mapped = current.legacyVehicleMapping?.[key];
  if (mapped) return mapped;
  return "ZEM_ESSENCE";
}

/** Vrai pour un moto-taxi (Zem essence ou électrique). */
export function isZem(vehicle?: VehicleKey | string | null): boolean {
  if (!vehicle) return false;
  return vehicleFamily(vehicle) === "ZEM";
}

export function vehicleFamily(vehicle: VehicleKey | string): VehicleFamily {
  const key = resolveVehicleKey(vehicle);
  return current.vehicles[key]?.family === "ZEM" || ZEM_VEHICLES.includes(key as VehicleKey)
    ? "ZEM"
    : "CAR";
}

export function vehicleLabel(vehicle: VehicleKey | string): string {
  const key = resolveVehicleKey(vehicle);
  return current.vehicles[key]?.airConditioned ? `${key} · climatisé` : key;
}

/** Prix d'une course = tarif de base + coût kilométrique par tranche (FCFA entiers). */
export type PriceBracketLine = {
  upToKm: number | null;
  perKm: number;
  km: number;
  amount: number;
};

export type PriceBreakdown = {
  vehicle: VehicleKey;
  family: VehicleFamily;
  distanceKm: number;
  /** Base effectivement facturée (après remise). */
  base: number;
  /** Base du barème avant remise (150 F pour un Zem à essence, 100 F en électrique). */
  baseFull: number;
  baseDiscountPct: number;
  baseDiscountApplied: boolean;
  baseDiscountAboveKm: number | null;
  brackets: PriceBracketLine[];
  price: number;
};

/**
 * Détail du prix — **exactement le même calcul que le backend** (`PricingService.breakdown`) :
 * base (remisée au-delà de la distance configurée) + une ligne par palier kilométrique.
 * Chaque poste est tronqué en FCFA entiers, sans arrondi métier.
 */
export function priceBreakdown(distanceKm: number, vehicle: VehicleKey | string): PriceBreakdown {
  const key = resolveVehicleKey(vehicle);
  const pricing = current.vehicles[key];
  const mmPerKm = 1000;
  const distance = Math.max(distanceKm, 0);
  const kmMm = Math.round(distance * mmPerKm);

  const brackets: PriceBracketLine[] = [];
  let previousLimitMm = 0;
  let kmAmount = 0;
  for (const bracket of pricing.brackets) {
    const upperLimitMm = bracket.upToKm === null ? kmMm : Math.round(bracket.upToKm * mmPerKm);
    const bracketMm = Math.max(Math.min(kmMm, upperLimitMm) - previousLimitMm, 0);
    const amount = Math.floor((bracketMm * bracket.perKm) / mmPerKm);
    brackets.push({ upToKm: bracket.upToKm, perKm: bracket.perKm, km: bracketMm / mmPerKm, amount });
    kmAmount += amount;
    previousLimitMm = bracket.upToKm === null ? kmMm : upperLimitMm;
  }

  const discount = pricing.baseDiscount;
  const applied = !!discount && distance > discount.aboveKm;
  const base = applied ? Math.floor((pricing.base * (100 - discount!.pct)) / 100) : pricing.base;

  return {
    vehicle: key,
    family: vehicleFamily(key),
    distanceKm: distance,
    base,
    baseFull: pricing.base,
    baseDiscountPct: discount?.pct ?? 0,
    baseDiscountApplied: applied,
    baseDiscountAboveKm: discount?.aboveKm ?? null,
    brackets,
    price: base + kmAmount,
  };
}

export function ridePrice(distanceKm: number, vehicle: VehicleKey | string): number {
  return priceBreakdown(distanceKm, vehicle).price;
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
    vehicles: config.vehicles ?? (reference as unknown as TarificationConfig).vehicles,
    agencyLevels: config.agencyLevels ?? (reference as unknown as TarificationConfig).agencyLevels,
    profiles: config.profiles ?? {},
    legacyVehicleMapping: config.legacyVehicleMapping ?? {},
    agencyActivation: config.agencyActivation ?? { requiredForOperations: true },
  };
}
