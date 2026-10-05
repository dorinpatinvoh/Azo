import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  AgencyLevel,
  AgencyLevelPricing,
  ProfilePricing,
  TarificationConfig,
  VehicleGamme,
  VehicleKey,
  VehiclePricing,
  TARIFICATION_CONFIG,
  loadTarificationConfig,
} from "./tarification.config";

/** Détail du calcul d'un prix de course, poste par poste. */
export type RidePriceBreakdown = {
  gamme: VehicleGamme;
  distanceKm: number;
  kmThreshold: number;
  base: number;
  perKmUpTo15: number;
  perKmFrom16: number;
  kmInFirstBracket: number;
  kmInSecondBracket: number;
  amountInFirstBracket: number;
  amountInSecondBracket: number;
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

  get kmThreshold(): number {
    return this.config.kmThreshold;
  }

  /** Gammes de véhicules facturables (GAZELLE, KOALA, LEOPARD). */
  vehicleGammes(): VehicleGamme[] {
    return Object.keys(this.config.vehicles) as VehicleGamme[];
  }

  /**
   * Ramène tout type de véhicule (y compris les anciens ZEM / ZEM_ELECTRIC / CAR)
   * à une gamme de facturation.
   */
  resolveGamme(vehicleType: VehicleKey | string): VehicleGamme {
    const key = String(vehicleType || "").toUpperCase();
    if (key in this.config.vehicles) return key as VehicleGamme;
    const mapped = this.config.legacyVehicleMapping?.[key];
    if (mapped && mapped in this.config.vehicles) return mapped;
    throw new Error(
      `Gamme de véhicule inconnue : « ${vehicleType} » (config tarification.vehicles / legacyVehicleMapping)`
    );
  }

  getVehiclePricing(vehicleType: VehicleKey | string): VehiclePricing {
    return this.config.vehicles[this.resolveGamme(vehicleType)];
  }

  /** Libellé commercial de la gamme (KOALA est la gamme climatisée). */
  vehicleLabel(vehicleType: VehicleKey | string): string {
    const gamme = this.resolveGamme(vehicleType);
    const pricing = this.config.vehicles[gamme];
    return pricing.airConditioned ? `${gamme} (climatisé)` : gamme;
  }

  /**
   * Prix d'une course = tarif de base + coût kilométrique par tranche.
   *
   *   km_tranche1 = min(distance_km, seuil)
   *   km_tranche2 = max(distance_km - seuil, 0)
   *   prix = base + km_tranche1 × prix_0_seuil + km_tranche2 × prix_seuil_plus
   *
   * Retourne un entier FCFA : le coût kilométrique est tronqué (aucun arrondi).
   */
  ridePrice(distanceKm: number, vehicleType: VehicleKey | string): number {
    return this.breakdown(distanceKm, vehicleType).price;
  }

  breakdown(distanceKm: number, vehicleType: VehicleKey | string): RidePriceBreakdown {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) {
      throw new Error("La distance d'une course doit être un nombre de km positif");
    }

    const gamme = this.resolveGamme(vehicleType);
    const pricing = this.config.vehicles[gamme];
    const threshold = this.config.kmThreshold;

    // Calcul en millimètres entiers : la distance est ramenée au mètre près et les
    // multiplications restent exactes (20,9 − 15 = 5,899999… donnerait 884 au lieu de
    // 885 en flottant). Le montant rendu est un entier FCFA tronqué, sans arrondi métier.
    const mmPerKm = 1000;
    const kmMm = Math.round(distanceKm * mmPerKm);
    const thresholdMm = Math.round(threshold * mmPerKm);
    const firstBracketMm = Math.min(kmMm, thresholdMm);
    const secondBracketMm = Math.max(kmMm - thresholdMm, 0);

    const kmInFirstBracket = firstBracketMm / mmPerKm;
    const kmInSecondBracket = secondBracketMm / mmPerKm;
    const amountInFirstBracket = Math.floor((firstBracketMm * pricing.perKmUpTo15) / mmPerKm);
    const amountInSecondBracket = Math.floor((secondBracketMm * pricing.perKmFrom16) / mmPerKm);
    const price = pricing.base + amountInFirstBracket + amountInSecondBracket;

    return {
      gamme,
      distanceKm,
      kmThreshold: threshold,
      base: pricing.base,
      perKmUpTo15: pricing.perKmUpTo15,
      perKmFrom16: pricing.perKmFrom16,
      kmInFirstBracket,
      kmInSecondBracket,
      amountInFirstBracket,
      amountInSecondBracket,
      price,
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

  /** Commission AZƆ̀ d'une course : niveau d'agence si rattaché, sinon profil, sinon 0. */
  rideCommission(
    user: { profile?: string | null; agencyLevel?: AgencyLevel | string | null },
    rideAmount: number
  ): number {
    if (user.agencyLevel) return this.agencyCommission(user.agencyLevel, rideAmount);
    const pct = this.profilePricing(user.profile ?? "").monthlyRevenueSharePct;
    // La commission d'une course n'existe que pour les profils qui la définissent ;
    // les Zem indépendants paient leur part au mois (voir monthlyRevenueShare).
    void pct;
    return this.percentOf(rideAmount, this.config.unspecifiedProfile.rideCommissionPct);
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
