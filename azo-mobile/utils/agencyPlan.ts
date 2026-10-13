/** Nom d'affichage des niveaux d'agence : Pro, Silver, Or et Diamant (sans le mot « Agence »). */
const NAMES: Record<string, string> = { PRO: "Pro", SILVER: "Silver", OR: "Or", DIAMANT: "Diamant" };

export function agencyPlanName(plan: string | null | undefined): string {
  if (!plan) return "";
  return NAMES[plan.toUpperCase()] ?? plan;
}
