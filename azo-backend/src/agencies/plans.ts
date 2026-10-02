import { AgencyPlan } from "@prisma/client";

// Grille officielle AZƆ̀ : activation unique (FCFA), plafond de comptes, commission.
// Fichier séparé pour être partagé par les modules Agences et Prestataires
// (un import direct entre les deux modules créerait une dépendance circulaire).
export const PLANS: Record<AgencyPlan, { fee: number; maxAccounts: number; rate: number }> = {
  PRO:     { fee: 100000, maxAccounts: 10,   rate: 0.03 },
  ARGENT:  { fee: 215500, maxAccounts: 25,   rate: 0.025 },
  OR:      { fee: 450500, maxAccounts: 100,  rate: 0.02 },
  DIAMANT: { fee: 600500, maxAccounts: 1000, rate: 0.01 },
};

export const PLAN_LABELS: Record<AgencyPlan, string> = {
  PRO: "Agence Pro",
  ARGENT: "Agence Argent",
  OR: "Agence Or",
  DIAMANT: "Agence Diamant",
};
