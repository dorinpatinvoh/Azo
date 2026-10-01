import { AgencyPlan } from "@prisma/client";

// Formules du modèle économique AZƆ̀ : activation unique, comptes max., commission.
// Fichier séparé pour être partagé par les modules Agences et Prestataires
// (un import direct entre les deux modules créerait une dépendance circulaire).
export const PLANS: Record<AgencyPlan, { fee: number; maxAccounts: number; rate: number }> = {
  PRO:     { fee: 45000,  maxAccounts: 10,   rate: 0.03 },
  ARGENT:  { fee: 100000, maxAccounts: 25,   rate: 0.025 },
  OR:      { fee: 250000, maxAccounts: 100,  rate: 0.02 },
  DIAMANT: { fee: 500000, maxAccounts: 1000, rate: 0.01 },
};

export const PLAN_LABELS: Record<AgencyPlan, string> = {
  PRO: "Pro Flotte",
  ARGENT: "Argent",
  OR: "Or",
  DIAMANT: "Diamant",
};
