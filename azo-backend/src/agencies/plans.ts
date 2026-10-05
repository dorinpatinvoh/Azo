import { AgencyPlan } from "@prisma/client";
import { loadTarificationConfig } from "../pricing/tarification.config";

// Grille officielle AZƆ̀ : elle vient de la configuration tarifaire
// (`src/pricing/tarification.json`), jamais codée en dur ici.
// Fichier séparé pour être partagé par les modules Agences et Prestataires
// (un import direct entre les deux modules créerait une dépendance circulaire).
//
// Les niveaux ne concernent QUE les agences :
//   activation (paiement unique) · commission par course · frais par retrait · plafond de comptes.
const config = loadTarificationConfig();

export type AgencyLevelRules = {
  fee: number;
  maxAccounts: number;
  rate: number;
  withdrawalFeePct: number;
};

export const PLANS: Record<AgencyPlan, AgencyLevelRules> = Object.fromEntries(
  (Object.keys(config.agencyLevels) as (keyof typeof config.agencyLevels)[]).map((level) => [
    level,
    {
      fee: config.agencyLevels[level].activationFee,
      maxAccounts: config.agencyLevels[level].maxAccounts,
      rate: config.agencyLevels[level].commissionPct / 100,
      withdrawalFeePct: config.agencyLevels[level].withdrawalFeePct,
    },
  ])
) as Record<AgencyPlan, AgencyLevelRules>;

export const PLAN_LABELS: Record<AgencyPlan, string> = {
  PRO: "Agence Pro",
  SILVER: "Agence Silver",
  OR: "Agence Or",
  DIAMANT: "Agence Diamant",
};

/** Frais prélevés à chaque retrait d'une agence, selon son niveau. */
export function agencyWithdrawalFeePct(plan: AgencyPlan): number {
  return PLANS[plan].withdrawalFeePct;
}
