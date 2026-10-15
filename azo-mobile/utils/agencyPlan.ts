/** Nom d'affichage des niveaux d'agence : Pro, Silver, Or, Diamant, Platine et Elite (sans le mot « Agence »). */
const NAMES: Record<string, string> = { PRO: "Pro", SILVER: "Silver", OR: "Or", DIAMANT: "Diamant", PLATINE: "Platine", ELITE: "Elite" };

export function agencyPlanName(plan: string | null | undefined): string {
  if (!plan) return "";
  return NAMES[plan.toUpperCase()] ?? plan;
}
