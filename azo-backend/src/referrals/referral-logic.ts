/** Règles du parrainage (sans accès à la base : testables seules). */

export type ReferralKind = "SPEEDER" | "AGENCE" | "COURSIER_PERSONNEL" | "LIVREUR_EXPRESS";
export const REFERRAL_KINDS: ReferralKind[] = ["SPEEDER", "AGENCE", "COURSIER_PERSONNEL", "LIVREUR_EXPRESS"];

/** Un prestataire sans course ni livraison terminée depuis ce nombre de jours est « inactif ». */
export const ACTIVE_WINDOW_DAYS = 30;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans I, L, O, 0, 1 : pas de confusion à la dictée
const CODE_PREFIX = "AZO-";

/** Nouveau code de parrainage : « AZO- » suivi de 6 caractères (ex. AZO-7K4M2Q). */
export function generateReferralCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return CODE_PREFIX + out;
}

/** Code saisi par un utilisateur : espaces et casse ignorés, préfixe « AZO- » facultatif. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const compact = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return null;
  const body = compact.startsWith("AZO") && compact.length === 9 ? compact.slice(3) : compact;
  if (body.length !== 6) return null;
  return CODE_PREFIX + body;
}

/** Catégorie d'un prestataire pour le suivi du parrain. */
export function kindOf(
  provider: { type: string; categoryId: string | null } | null | undefined,
  signupKind: string | null | undefined
): ReferralKind | null {
  if (provider) {
    if (provider.type === "DRIVER") return "SPEEDER";
    if (provider.type === "AGENCY") return "AGENCE";
    if (provider.type === "COURIER") return provider.categoryId === "COURSIER_PERSONNEL" ? "COURSIER_PERSONNEL" : "LIVREUR_EXPRESS";
    return null;
  }
  if (signupKind === "DRIVER") return "SPEEDER";
  if (signupKind === "AGENCY") return "AGENCE";
  return null; // inscription « COURIER » sans dossier : la spécialité n'est pas encore connue
}

export type ReferralStatus = "ACTIF" | "INACTIF" | "EN_ATTENTE" | "REFUSE" | "SUSPENDU";

/**
 * État d'un filleul : dossier en attente, refusé, suspendu ; ou validé — actif s'il a terminé au moins une course ou
 * livraison dans les 30 derniers jours, sinon inactif.
 */
export function statusOf(providerStatus: string | null | undefined, lastActivityAt: Date | null, now: Date = new Date()): ReferralStatus {
  if (providerStatus === "APPROVED") {
    if (!lastActivityAt) return "INACTIF";
    return now.getTime() - lastActivityAt.getTime() <= ACTIVE_WINDOW_DAYS * 24 * 3600 * 1000 ? "ACTIF" : "INACTIF";
  }
  if (providerStatus === "REJECTED") return "REFUSE";
  if (providerStatus === "SUSPENDED") return "SUSPENDU";
  return "EN_ATTENTE"; // brouillon, déposé, en examen, information demandée, ou pas encore de dossier
}

/** « +2290197000042 » → « 01 •• •• •• 42 » : le parrain reconnaît son filleul sans voir le numéro complet. */
export function maskPhone(phone: string): string {
  const digits = String(phone).replace(/\D/g, "");
  const local = digits.startsWith("229") ? digits.slice(3) : digits;
  if (local.length < 4) return "•• •• •• ••";
  return `${local.slice(0, 2)} •• •• •• ${local.slice(-2)}`;
}
