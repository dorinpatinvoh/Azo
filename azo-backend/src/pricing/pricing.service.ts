import { Inject, Injectable, Optional } from "@nestjs/common";
import type { RadarSettings } from "../rides/radar";
import {
  AgencyLevel,
  AgencyLevelPricing,
  ProfilePricing,
  TarificationConfig,
  VehicleFamily,
  VehicleKey,
  VehiclePricing,
  ZEM_VEHICLE_KEYS,
  TARIFICATION_CONFIG,
  loadTarificationConfig,
} from "./tarification.config";

/** Une ligne du calcul : kilomètres parcourus dans un palier et montant correspondant. */
export type RidePriceBracketLine = {
  /** Borne haute du palier (incluse), `null` pour le dernier palier (illimité). */
  upToKm: number | null;
  perKm: number;
  /** Kilomètres facturés dans ce palier (0 si le trajet n'y entre pas). */
  km: number;
  amount: number;
};

/** Détail du calcul d'un prix de course, poste par poste. */
export type RidePriceBreakdown = {
  /**
   * Véhicule facturé : ZEM_ESSENCE, ZEM_ELECTRIC (motos-taxis) ou GAZELLE, KOALA,
   * LEOPARD (voitures). Le nom de champ `gamme` est conservé pour l'API mobile.
   */
  gamme: VehicleKey;
  family: VehicleFamily;
  distanceKm: number;
  /** Base effectivement facturée (après remise). */
  base: number;
  /** Base du barème avant remise (150 F pour un Zem). */
  baseFull: number;
  /** Remise appliquée à la base (0 ou 25 % pour un Zem au-delà de 10 km). */
  baseDiscountPct: number;
  baseDiscountApplied: boolean;
  /** Distance à partir de laquelle la remise de base s'applique. */
  baseDiscountAboveKm: number | null;
  brackets: RidePriceBracketLine[];
  price: number;
  currency: string;
};

export type WithdrawalFees = {
  amount: number;
  feePct: number;
  fee: number;
  netAmount: number;
  currency: string;
};

/**
 * Service de tarification AZƆ̀.
 *
 * Toutes les règles viennent de `tarification.json` : prix des courses (par gamme
 * de véhicule et par tranche de km), commissions et frais des agences, profils
 * prestataires (part mensuelle des Zem indépendants, frais de retrait).
 *
 * Convention de montants : FCFA, entiers, **sans arrondi** — troncature des
 * décimales (`Math.floor`) conformément à la spécification.
 */
@Injectable()
export class PricingService {
  private readonly config: TarificationConfig;

  /**
   * La configuration est injectée (jeton `TARIFICATION_CONFIG`) : une seule instance
   * pour toute l'application. Sans injection — tests unitaires — elle est chargée
   * directement depuis `tarification.json`.
   */
  constructor(@Optional() @Inject(TARIFICATION_CONFIG) config?: TarificationConfig) {
    this.config = config ?? loadTarificationConfig();
  }

  getConfig(): TarificationConfig {
    return this.config;
  }

  get currency(): string {
    return this.config.currency;
  }

  /** Véhicules facturables, dans l'ordre d'affichage (Zem puis voitures). */
  vehicleKeys(): VehicleKey[] {
    return Object.keys(this.config.vehicles) as VehicleKey[];
  }

  /** Filière d'un véhicule : `ZEM` (moto-taxi) ou `CAR` (voiture). */
  vehicleFamily(vehicleType: string): VehicleFamily {
    const vehicle = this.resolveVehicleKey(vehicleType);
    return this.config.vehicles[vehicle].family === "ZEM" ? "ZEM" : "CAR";
  }

  /** Vrai pour un moto-taxi (Zem essence ou électrique). */
  isZem(vehicleType?: string | null): boolean {
    if (!vehicleType) return false;
    try {
      return this.vehicleFamily(vehicleType) === "ZEM";
    } catch {
      return false;
    }
  }

  /** Les deux types de Zem (moto-taxi) : essence et électrique. */
  zemVehicleKeys(): VehicleKey[] {
    return [...ZEM_VEHICLE_KEYS];
  }

  /**
   * Ramène tout type de véhicule (y compris les anciens ZEM / CAR encore en base)
   * à un véhicule facturable de la configuration.
   */
  resolveVehicleKey(vehicleType: VehicleKey | string): VehicleKey {
    const key = String(vehicleType || "").toUpperCase();
    if (key in this.config.vehicles) return key as VehicleKey;
    const mapped = this.config.legacyVehicleMapping?.[key];
    if (mapped && mapped in this.config.vehicles) return mapped;
    throw new Error(
      `Véhicule inconnu : « ${vehicleType} » (config tarification.vehicles / legacyVehicleMapping)`
    );
  }

  getVehiclePricing(vehicleType: VehicleKey | string): VehiclePricing {
    return this.config.vehicles[this.resolveVehicleKey(vehicleType)];
  }

  /** Libellé commercial du véhicule (KOALA est la voiture climatisée). */
  vehicleLabel(vehicleType: VehicleKey | string): string {
    const vehicle = this.resolveVehicleKey(vehicleType);
    const pricing = this.config.vehicles[vehicle];
    return pricing.airConditioned ? `${vehicle} (climatisé)` : vehicle;
  }

  /**
   * Filtrage du radar chauffeur (`GET /rides/pending`) : le prestataire ne reçoit que
   * les demandes correspondant au véhicule qu'il a déclaré.
   *
   *   * `strictVehicleMatch = true` (défaut) : correspondance EXACTE — un Zem électrique
   *     ne voit pas les demandes de Zem à essence, et Gazelle ≠ Koala ≠ Léopard.
   *   * `false` (démarrage / démonstration) : les deux Zem partagent leurs demandes ;
   *     les voitures restent filtrées par gamme exacte.
   */
  rideVisibleFor(driverVehicle?: string | null, rideVehicle?: string | null): boolean {
    if (!rideVehicle) return true;
    const ride = this.resolveVehicleKey(rideVehicle);

    // Chauffeur sans véhicule déclaré (compte historique) : on ne lui cache rien.
    if (!driverVehicle) return true;
    const driver = this.resolveVehicleKey(driverVehicle);

    if (this.config.radar?.strictVehicleMatch ?? true) return driver === ride;

    // Mode souple : les deux types de Zem partagent leurs demandes ; les voitures
    // restent filtrées par gamme exacte.
    const driverIsZem = this.vehicleFamily(driver) === "ZEM";
    const rideIsZem = this.vehicleFamily(ride) === "ZEM";
    if (rideIsZem) return driverIsZem;
    return driver === ride;
  }

  /**
   * Réglages du radar des demandes, avec leurs valeurs par défaut.
   *
   * Utilisés par `RidesService` : filtrage par véhicule (`strictVehicleMatch`), rayon de
   * recherche autour du chauffeur (`searchRadiusKm`), expiration d'une demande sans
   * chauffeur (`pendingExpiryMinutes`) et nombre de chauffeurs prévenus à la publication
   * (`driverNotificationMax`).
   */
  radarSettings(): RadarSettings {
    const radar = this.config.radar ?? {};
    return {
      strictVehicleMatch: radar.strictVehicleMatch ?? true,
      searchRadiusKm: radar.searchRadiusKm ?? 0,
      pendingExpiryMinutes: radar.pendingExpiryMinutes ?? 30,
      driverNotificationMax: radar.driverNotificationMax ?? 30,
    };
  }

  /**
   * Prix d'une course = base (remisée le cas échéant) + somme des paliers kilométriques.
   *
   * Chaque véhicule porte ses paliers dans la configuration (`brackets`) :
   *
   *   * **Zem** (motos-taxis) : **mêmes paliers** pour les deux types — **70 F/km de 0 à
   *     15 km**, **60 F/km de 16 à 25 km**, **50 F/km à partir du 26e km** ; seule la base
   *     diffère (150 F à essence, 100 F en électrique), sans remise ;
   *   * **voitures** : base et deux paliers (ex. Gazelle 800 F, 200 F/km jusqu'à 15 km
   *     puis 150 F/km), sans remise de base.
   *
   * Retourne un entier FCFA : chaque poste est tronqué, aucun arrondi métier.
   */
  ridePrice(distanceKm: number, vehicleType: VehicleKey | string): number {
    return this.breakdown(distanceKm, vehicleType).price;
  }

  breakdown(distanceKm: number, vehicleType: VehicleKey | string): RidePriceBreakdown {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) {
      throw new Error("La distance d'une course doit être un nombre de km positif");
    }

    const gamme = this.resolveVehicleKey(vehicleType);
    const pricing = this.config.vehicles[gamme];

    // Calcul en millimètres entiers : la distance est ramenée au mètre près et les
    // multiplications restent exactes (20,9 − 15 = 5,899999… donnerait 884 au lieu de
    // 885 en flottant). Le montant rendu est un entier FCFA tronqué, sans arrondi métier.
    const mmPerKm = 1000;
    const kmMm = Math.round(distanceKm * mmPerKm);

    // Paliers : chaque borne est cumulée depuis le début du trajet (0 → 10 km, puis le
    // 11e au tarif suivant, etc.). Le dernier palier (upToKm = null) prend le reste.
    const brackets: RidePriceBracketLine[] = [];
    let previousLimitMm = 0;
    let kmAmount = 0;

    for (const bracket of pricing.brackets) {
      const upperLimitMm = bracket.upToKm === null ? kmMm : Math.round(bracket.upToKm * mmPerKm);
      const bracketMm = Math.max(Math.min(kmMm, upperLimitMm) - previousLimitMm, 0);
      const amount = Math.floor((bracketMm * bracket.perKm) / mmPerKm);
      brackets.push({
        upToKm: bracket.upToKm,
        perKm: bracket.perKm,
        km: bracketMm / mmPerKm,
        amount,
      });
      kmAmount += amount;
      previousLimitMm = bracket.upToKm === null ? kmMm : upperLimitMm;
    }

    // Remise de base : uniquement au-delà de la distance configurée (Zem : plus de 10 km).
    const discount = pricing.baseDiscount;
    const discountApplied = !!discount && distanceKm > discount.aboveKm;
    const base = discountApplied
      ? Math.floor((pricing.base * (100 - discount!.pct)) / 100)
      : pricing.base;

    return {
      gamme,
      family: pricing.family === "ZEM" ? "ZEM" : "CAR",
      distanceKm,
      base,
      baseFull: pricing.base,
      baseDiscountPct: discount?.pct ?? 0,
      baseDiscountApplied: discountApplied,
      baseDiscountAboveKm: discount?.aboveKm ?? null,
      brackets,
      price: base + kmAmount,
      currency: this.config.currency,
    };
  }

  /* ------------------------------------------------------------------ Agences */

  getAgencyLevel(level: AgencyLevel | string): AgencyLevelPricing {
    const key = String(level || "").toUpperCase() as AgencyLevel;
    const pricing = this.config.agencyLevels[key];
    if (!pricing) throw new Error(`Niveau d'agence inconnu : « ${level} »`);
    return pricing;
  }

  /** Frais d'activation (paiement unique, non récurrent). */
  agencyActivationFee(level: AgencyLevel | string): number {
    return this.getAgencyLevel(level).activationFee;
  }

  agencyMaxAccounts(level: AgencyLevel | string): number {
    return this.getAgencyLevel(level).maxAccounts;
  }

  /** Commission AZƆ̀ prélevée sur une course réalisée par une agence. */
  agencyCommission(level: AgencyLevel | string, rideAmount: number): number {
    return this.percentOf(rideAmount, this.getAgencyLevel(level).commissionPct);
  }

  /** Frais prélevés à chaque retrait d'une agence. */
  agencyWithdrawalFees(level: AgencyLevel | string, amount: number): WithdrawalFees {
    return this.withdrawalFees(amount, this.getAgencyLevel(level).withdrawalFeePct);
  }

  /** Une agence ne peut opérer qu'une fois ses frais d'activation payés. */
  agencyCanOperate(agency: { plan: AgencyLevel | string; feePaidAt?: Date | null }): boolean {
    if (!this.config.agencyActivation.requiredForOperations) return true;
    return !!agency.feePaidAt;
  }

  /** Nombre de comptes restants (0 = plafond atteint, refuser toute création). */
  agencyRemainingAccounts(level: AgencyLevel | string, currentAccounts: number): number {
    return Math.max(this.agencyMaxAccounts(level) - currentAccounts, 0);
  }

  /** Un compte peut-il être créé/rattaché sans dépasser la limite du niveau ? */
  canAgencyAddAccount(level: AgencyLevel | string, currentAccounts: number): boolean {
    return this.agencyRemainingAccounts(level, currentAccounts) > 0;
  }

  /* ------------------------------------------------------------------ Profils */

  profilePricing(profile: string): ProfilePricing {
    const key = String(profile || "").toUpperCase();
    const configured = (this.config.profiles as Record<string, ProfilePricing | undefined>)[key];
    if (configured) return configured;
    // Profil non décrit par la spécification : on retombe sur « aucun prélèvement ».
    return this.config.unspecifiedProfile as ProfilePricing;
  }

  profileCategory(profile: string): string | null {
    return this.profilePricing(profile).category ?? null;
  }

  /** Part mensuelle prélevée sur les revenus du mois (15 % pour un Zem indépendant). */
  monthlyRevenueShare(profile: string, monthRevenue: number): number {
    return this.percentOf(monthRevenue, this.profilePricing(profile).monthlyRevenueSharePct ?? 0);
  }

  /** Frais prélevés sur chaque retrait (1,5 % pour un Zem indépendant). */
  profileWithdrawalFees(profile: string, amount: number): WithdrawalFees {
    return this.withdrawalFees(amount, this.profilePricing(profile).withdrawalFeePct ?? 0);
  }

  /**
   * Frais de retrait d'un prestataire, dans l'ordre de priorité :
   *   1. le profil (ZEM_INDEPENDANT → 1,5 %),
   *   2. l'agence si le prestataire est rattaché à une flotte,
   *   3. aucun frais pour les profils non décrits par la spécification.
   */
  withdrawalFeesFor(
    user: { profile?: string | null; agencyLevel?: AgencyLevel | string | null },
    amount: number
  ): WithdrawalFees {
    const profilePricing = user.profile ? this.profilePricing(user.profile) : null;
    if (profilePricing?.withdrawalFeePct != null) {
      return this.withdrawalFees(amount, profilePricing.withdrawalFeePct);
    }
    if (user.agencyLevel) return this.agencyWithdrawalFees(user.agencyLevel, amount);
    return this.withdrawalFees(amount, 0);
  }

  /**
   * Commission AZƆ̀ d'une course : niveau d'agence si le conducteur est rattaché à une
   * flotte, sinon la règle du profil.
   *
   * Le Zem indépendant a `rideCommissionPct = 0` — règle validée — car il paie 15 % de
   * ses revenus au mois (voir `monthlyRevenueShare`), jamais par course. Pour LIVREUR et
   * COURSIER la valeur est provisoire (« règle à définir », voir `aDefinir` dans la
   * configuration) : elle ne doit pas être présentée comme une règle validée.
   */
  rideCommission(
    user: { profile?: string | null; agencyLevel?: AgencyLevel | string | null },
    rideAmount: number
  ): number {
    if (user.agencyLevel) return this.agencyCommission(user.agencyLevel, rideAmount);
    const profile = user.profile ? this.profilePricing(user.profile) : null;
    const pct = profile?.rideCommissionPct ?? this.config.unspecifiedProfile.rideCommissionPct;
    return this.percentOf(rideAmount, pct);
  }

  /* ------------------------------------------------------------------ Livraison */

  /** Livraison : non décrite par la spécification, taux conservé en configuration. */
  deliveryCommission(amount: number): number {
    return this.percentOf(amount, this.config.delivery?.commissionPct ?? 0);
  }

  /* ------------------------------------------------------------------ Outils */

  /** Pourcentage d'un montant en FCFA entier, tronqué (pas d'arrondi). */
  percentOf(amount: number, pct: number): number {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Montant invalide");
    return Math.floor((amount * pct) / 100);
  }

  withdrawalFees(amount: number, feePct: number): WithdrawalFees {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Montant de retrait invalide");
    const fee = this.percentOf(amount, feePct);
    return { amount, feePct, fee, netAmount: amount - fee, currency: this.config.currency };
  }
}
