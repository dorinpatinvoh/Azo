import { MaterialIcons } from "@expo/vector-icons";
import { agencyLevelPricing, tarification, type AgencyLevel } from "../services/tarification";
import type { AgencyPlanChoice, VehicleType } from "../services/api";
import { agencyPlanName } from "./agencyPlan";

/** Choix proposés à la création du compte professionnel : type de véhicule (Speeder, coursier) ou niveau d'agence. */
export type VehicleOption = { value: VehicleType; label: string; hint: string };

const MOTO_ESSENCE: VehicleOption = { value: "ZEM_ESSENCE", label: "Moto à essence", hint: "Moto thermique, rapide et économique" };
const MOTO_ELECTRIQUE: VehicleOption = { value: "ZEM_ELECTRIC", label: "Moto électrique", hint: "Moto électrique, zéro émission" };
const TRICYCLE: VehicleOption = { value: "ZEM_TRICYCLE", label: "Tricycle", hint: "Tricycle, charges plus volumineuses" };
const GAZELLE: VehicleOption = { value: "GAZELLE", label: "Gazelle — Voiture", hint: "Voiture d'entrée de gamme" };
const KOALA: VehicleOption = { value: "KOALA", label: "Koala — Voiture climatisée", hint: "Voiture intermédiaire climatisée" };
const LEOPARD: VehicleOption = { value: "LEOPARD", label: "Léopard — Berline premium climatisée", hint: "Berline haut de gamme climatisée" };

/** Speeder (transport de clients) : motos, tricycle et voitures. */
export const DRIVER_VEHICLE_OPTIONS: VehicleOption[] = [MOTO_ESSENCE, MOTO_ELECTRIQUE, TRICYCLE, GAZELLE, KOALA, LEOPARD];
/** Coursier personnel : on accompagne un client, une voiture est possible. */
export const COURIER_PERSONAL_VEHICLE_OPTIONS: VehicleOption[] = [MOTO_ESSENCE, MOTO_ELECTRIQUE, TRICYCLE, GAZELLE, KOALA, LEOPARD];
/** Livreur express : les voitures ne livrent pas de colis, seulement motos et tricycle. */
export const COURIER_EXPRESS_VEHICLE_OPTIONS: VehicleOption[] = [MOTO_ESSENCE, MOTO_ELECTRIQUE, TRICYCLE];

/** Icône MaterialIcons d'un véhicule (moto essence / moto électrique / tricycle / voiture). */
export function vehicleIcon(value: VehicleType): keyof typeof MaterialIcons.glyphMap {
  if (value === "ZEM_ELECTRIC") return "electric-moped";
  if (value === "ZEM_TRICYCLE") return "electric-rickshaw";
  if (value === "ZEM_ESSENCE") return "two-wheeler";
  if (value === "LEOPARD") return "local-taxi";
  return "directions-car";
}

// Une agence choisit directement son niveau : Pro, Silver, Or, Diamant, Platine ou Elite. Montants et plafonds viennent de la grille
// officielle partagée (jamais codés en dur ici).
export const AGENCY_LEVEL_CHOICES = (Object.keys(tarification().agencyLevels) as AgencyLevel[]).map((plan) => {
  const rules = agencyLevelPricing(plan);
  return {
    plan: plan as AgencyPlanChoice,
    label: agencyPlanName(plan),
    hint:
      `Activation unique : ${rules.activationFee.toLocaleString("fr-FR")} F · Jusqu'à ${rules.maxAccounts.toLocaleString("fr-FR")} comptes · ` +
      `Commission : ${String(rules.commissionPct).replace(".", ",")} % · Frais de retrait : ${String(rules.withdrawalFeePct).replace(".", ",")} %`,
  };
});
