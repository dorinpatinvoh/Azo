import { readFileSync } from "fs";
import { join } from "path";
import embeddedConfig from "./tarification.json";

/**
 * Chargement de la configuration tarifaire AZƆ̀.
 *
 * La configuration vit dans `tarification.json` (aucune règle de prix n'est codée
 * en dur dans la logique métier). Elle peut être surchargée sans reconstruire le
 * code via la variable d'environnement `TARIFICATION_CONFIG_PATH` (fichier monté,
 * volume Render, ou export depuis la base).
 */

/** Gammes de véhicules définies par la spécification AZƆ̀. */
export type VehicleGamme = "GAZELLE" | "KOALA" | "LEOPARD";

/** Types de véhicules historiques encore présents en base (courses/dossiers passés). */
export type LegacyVehicleType = "ZEM" | "ZEM_ELECTRIC" | "CAR";

export type VehicleKey = VehicleGamme | LegacyVehicleType;

/** Niveaux d'agence (les niveaux ne concernent QUE les agences). */
export type AgencyLevel = "PRO" | "SILVER" | "OR" | "DIAMANT";

/** Profils prestataires définis par la spécification. */
export type ProfileKey = "ZEM_INDEPENDANT" | "LIVREUR" | "COURSIER";

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

export type ProfilePricing = {
  category?: string;
  monthlyRevenueSharePct?: number;
  withdrawalFeePct?: number;
  /** Commission prélevée sur chaque course (0 pour un Zem indépendant : part mensuelle). */
  rideCommissionPct?: number;
  _notes?: string;
  /** Valeurs provisoires « règle à définir » (jamais des règles validées). */
  _aDefinir?: string[];
};

/** Valeur provisoire documentée : « règle à définir » côté métier. */
export type ProvisionalRule = {
  chemin: string;
  valeurProvisoire: number;
  note: string;
};

export type TarificationConfig = {
  currency: string;
  kmThreshold: number;
  vehicles: Record<VehicleGamme, VehiclePricing>;
  agencyLevels: Record<AgencyLevel, AgencyLevelPricing>;
  profiles: Record<ProfileKey, ProfilePricing>;
  legacyVehicleMapping: Record<string, VehicleGamme>;
  unspecifiedProfile: {
    monthlyRevenueSharePct: number;
    withdrawalFeePct: number;
    rideCommissionPct: number;
    _aDefinir?: string[];
  };
  agencyActivation: { requiredForOperations: boolean };
  delivery: { commissionPct: number; _aDefinir?: string[] };
  /** Liste des valeurs provisoires : elles ne sont pas des règles validées. */
  aDefinir?: ProvisionalRule[];
};

export const DEFAULT_TARIFICATION_CONFIG_PATH = join(__dirname, "tarification.json");

/** Jeton d'injection Nest : la configuration tarifaire est partagée, jamais recréée. */
export const TARIFICATION_CONFIG = "TARIFICATION_CONFIG";

export type TarificationConfigProvider = { provide: string; useFactory: () => TarificationConfig };

const GAMMES: VehicleGamme[] = ["GAZELLE", "KOALA", "LEOPARD"];
const LEVELS: AgencyLevel[] = ["PRO", "SILVER", "OR", "DIAMANT"];

let cached: TarificationConfig | null = null;

function fail(message: string): never {
  throw new Error(`Configuration tarifaire AZƆ̀ invalide : ${message}`);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Vérifie la structure et les valeurs indispensables au calcul des prix. */
function assertValid(config: TarificationConfig): TarificationConfig {
  if (!config || typeof config !== "object") fail("fichier illisible");
  if (!isNonNegativeNumber(config.kmThreshold) || config.kmThreshold <= 0)
    fail("`kmThreshold` doit être un nombre > 0");

  for (const gamme of GAMMES) {
    const pricing = config.vehicles?.[gamme];
    if (!pricing) fail(`véhicule « ${gamme} » manquant dans \`vehicles\``);
    for (const key of ["base", "perKmUpTo15", "perKmFrom16"] as const) {
      if (!isNonNegativeNumber(pricing[key])) fail(`\`vehicles.${gamme}.${key}\` doit être un nombre ≥ 0`);
    }
  }

  for (const level of LEVELS) {
    const pricing = config.agencyLevels?.[level];
    if (!pricing) fail(`niveau d'agence « ${level} » manquant dans \`agencyLevels\``);
    for (const key of ["activationFee", "commissionPct", "withdrawalFeePct", "maxAccounts"] as const) {
      if (!isNonNegativeNumber(pricing[key])) fail(`\`agencyLevels.${level}.${key}\` doit être un nombre ≥ 0`);
    }
  }

  if (!config.profiles?.ZEM_INDEPENDANT) fail("profil « ZEM_INDEPENDANT » manquant dans `profiles`");
  if (!config.profiles?.LIVREUR || !config.profiles?.COURSIER)
    fail("profils « LIVREUR » et « COURSIER » attendus dans `profiles`");

  return config;
}

/**
 * Lit et met en cache la configuration tarifaire.
 *
 * Le fichier `tarification.json` est embarqué dans le build (import JSON), donc
 * `dist/` n'a besoin d'aucun fichier annexe. `TARIFICATION_CONFIG_PATH` permet de
 * surcharger le barème par un fichier monté, sans reconstruire l'application.
 */
export function loadTarificationConfig(): TarificationConfig {
  if (cached) return cached;

  const override = process.env.TARIFICATION_CONFIG_PATH;
  let parsed: TarificationConfig = embeddedConfig as unknown as TarificationConfig;

  if (override) {
    let raw: string;
    try {
      raw = readFileSync(override, "utf8");
    } catch {
      fail(`fichier introuvable : ${override}`);
    }
    try {
      parsed = JSON.parse(raw) as TarificationConfig;
    } catch {
      fail(`JSON illisible : ${override}`);
    }
  }

  cached = assertValid(parsed);
  return cached;
}

/** Utilisé par les tests pour repartir d'un fichier neuf. */
export function resetTarificationConfigCache() {
  cached = null;
}

/** Valeurs provisoires déclarées « règle à définir » (jamais des règles validées). */
export function provisionalRules(config: TarificationConfig = loadTarificationConfig()): ProvisionalRule[] {
  return config.aDefinir ?? [];
}

/** Lit une valeur par chemin pointé (ex. `profiles.LIVREUR.rideCommissionPct`). */
export function valueAtPath(config: TarificationConfig, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[key];
    return undefined;
  }, config);
}
