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

/**
 * Véhicules facturables AZƆ̀, en deux filières :
 *   * `ZEM`  : ZEM_ESSENCE, ZEM_ELECTRIC — motos-taxis (même tarif pour les deux types) ;
 *   * `CAR`  : GAZELLE, KOALA, LEOPARD — voitures (entrée de gamme, climatisée, premium).
 */
export type VehicleFamily = "ZEM" | "CAR";

export type VehicleKey = "ZEM_ESSENCE" | "ZEM_ELECTRIC" | "GAZELLE" | "KOALA" | "LEOPARD";

/** Clés de la filière Zem (moto-taxi) : mêmes règles de profil, même radar. */
export const ZEM_VEHICLE_KEYS: VehicleKey[] = ["ZEM_ESSENCE", "ZEM_ELECTRIC"];

/** Tous les véhicules facturables, dans l'ordre d'affichage (Zem puis voitures). */
export const VEHICLE_KEYS: VehicleKey[] = ["ZEM_ESSENCE", "ZEM_ELECTRIC", "GAZELLE", "KOALA", "LEOPARD"];

/** Types de véhicules historiques encore présents en base (courses/dossiers passés). */
export type LegacyVehicleType = "ZEM" | "CAR";

export type VehicleKeyOrLegacy = VehicleKey | LegacyVehicleType;

/** Niveaux d'agence (les niveaux ne concernent QUE les agences). */
export type AgencyLevel = "PRO" | "SILVER" | "OR" | "DIAMANT";

/** Profils prestataires définis par la spécification. */
export type ProfileKey = "ZEM_INDEPENDANT" | "LIVREUR" | "COURSIER";

/**
 * Palier kilométrique : `upToKm` est la borne haute du palier (incluse), `null` pour le
 * dernier palier (illimité). `perKm` est le prix au kilomètre dans ce palier.
 */
export type VehicleBracket = {
  upToKm: number | null;
  perKm: number;
};

/** Remise sur la base appliquée au-delà d'une distance (`aboveKm`). */
export type BaseDiscount = {
  pct: number;
  aboveKm: number;
};

export type VehiclePricing = {
  base: number;
  /** Paliers kilométriques, du premier au dernier (dernier = illimité). */
  brackets: VehicleBracket[];
  /** Remise éventuelle sur la base (Zem : −25 % au-delà de 10 km). */
  baseDiscount?: BaseDiscount;
  airConditioned?: boolean;
  /** Filière du véhicule : `ZEM` (moto-taxi) ou `CAR` (voiture). */
  family?: VehicleFamily;
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
  vehicles: Record<VehicleKey, VehiclePricing>;
  /** Répartition des demandes entre prestataires (filtrage du radar chauffeur). */
  radar?: { strictVehicleMatch?: boolean };
  agencyLevels: Record<AgencyLevel, AgencyLevelPricing>;
  profiles: Record<ProfileKey, ProfilePricing>;
  legacyVehicleMapping: Record<string, VehicleKey>;
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

const LEVELS: AgencyLevel[] = ["PRO", "SILVER", "OR", "DIAMANT"];
const FAMILIES: VehicleFamily[] = ["ZEM", "CAR"];

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

  for (const vehicle of VEHICLE_KEYS) {
    const pricing = config.vehicles?.[vehicle];
    if (!pricing) fail(`véhicule « ${vehicle} » manquant dans \`vehicles\``);
    if (!isNonNegativeNumber(pricing.base)) fail(`\`vehicles.${vehicle}.base\` doit être un nombre ≥ 0`);
    if (pricing.family && !FAMILIES.includes(pricing.family))
      fail(`\`vehicles.${vehicle}.family\` doit valoir « ZEM » ou « CAR »`);

    // Paliers kilométriques : au moins un, bornes croissantes, dernier palier illimité.
    const brackets = pricing.brackets;
    if (!Array.isArray(brackets) || brackets.length === 0)
      fail(`\`vehicles.${vehicle}.brackets\` doit contenir au moins un palier`);
    let previousUpTo = 0;
    brackets.forEach((bracket, index) => {
      if (!isNonNegativeNumber(bracket?.perKm))
        fail(`\`vehicles.${vehicle}.brackets[${index}].perKm\` doit être un nombre ≥ 0`);
      const isLast = index === brackets.length - 1;
      if (isLast) {
        if (bracket.upToKm !== null)
          fail(`\`vehicles.${vehicle}.brackets\` : le dernier palier doit avoir \`upToKm: null\` (illimité)`);
        return;
      }
      if (!isNonNegativeNumber(bracket.upToKm) || bracket.upToKm <= 0)
        fail(`\`vehicles.${vehicle}.brackets[${index}].upToKm\` doit être un nombre > 0 (ou null pour le dernier palier)`);
      if (bracket.upToKm <= previousUpTo)
        fail(`\`vehicles.${vehicle}.brackets\` : les bornes \`upToKm\` doivent être strictement croissantes`);
      previousUpTo = bracket.upToKm;
    });

    const discount = pricing.baseDiscount;
    if (discount) {
      if (!isNonNegativeNumber(discount.pct) || discount.pct > 100)
        fail(`\`vehicles.${vehicle}.baseDiscount.pct\` doit être un pourcentage entre 0 et 100`);
      if (!isNonNegativeNumber(discount.aboveKm) || discount.aboveKm <= 0)
        fail(`\`vehicles.${vehicle}.baseDiscount.aboveKm\` doit être un nombre > 0`);
    }
  }

  // Les deux types de Zem appartiennent obligatoirement à la filière ZEM : le radar
  // chauffeur et les règles de profil ZEM_INDEPENDANT s'appuient sur ce champ.
  for (const zem of ZEM_VEHICLE_KEYS) {
    const family = config.vehicles?.[zem]?.family;
    if (family !== "ZEM") fail(`\`vehicles.${zem}.family\` doit valoir « ZEM » (moto-taxi)`);
  }

  if (config.radar?.strictVehicleMatch != null && typeof config.radar.strictVehicleMatch !== "boolean")
    fail("`radar.strictVehicleMatch` doit être un booléen");

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
