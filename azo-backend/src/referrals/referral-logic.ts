/** Règles du parrainage (sans accès à la base : testables seules). */

export type ReferralKind = "SPEEDER" | "AGENCE" | "COURSIER_PERSONNEL" | "LIVREUR_EXPRESS";
export const REFERRAL_KINDS: ReferralKind[] = ["SPEEDER", "AGENCE", "COURSIER_PERSONNEL", "LIVREUR_EXPRESS"];

/** Un prestataire sans course ni livraison terminée depuis ce nombre de jours est « inactif ». */
export const ACTIVE_WINDOW_DAYS = 30;

const COMMERCIAL_PREFIX = "COM-AZO";
const LEGACY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // anciens codes « AZO-XXXXXX » (sans I, L, O, 0, 1)

/** Code promo d'un commercial : « COM-AZO » suivi de son numéro d'ordre sur au moins 3 chiffres (COM-AZO001, COM-AZO002…). */
export function commercialCode(n: number): string {
  return COMMERCIAL_PREFIX + String(Math.max(1, Math.trunc(n))).padStart(3, "0");
}

/** Numéro d'ordre du prochain commercial : un de plus que le plus grand déjà attribué. */
export function nextCommercialNumber(existingCodes: string[]): number {
  let max = 0;
  for (const code of existingCodes) {
    const m = /^COM-AZO(\d+)$/.exec(code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Ancien format (avant les commerciaux) : « AZO- » + 6 caractères. Gardé pour les codes déjà distribués. */
export function generateLegacyReferralCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += LEGACY_ALPHABET[Math.floor(random() * LEGACY_ALPHABET.length)];
  return "AZO-" + out;
}

/**
 * Code saisi par un utilisateur : casse, espaces et tirets ignorés. « com azo 1 », « COM-AZO001 » et « comazo001 » donnent
 * « COM-AZO001 ». Les anciens codes « AZO-XXXXXX » restent acceptés.
 */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const compact = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return null;
  const commercial = /^COMAZO(\d{1,6})$/.exec(compact);
  if (commercial) return commercialCode(Number(commercial[1]));
  const body = compact.startsWith("AZO") && compact.length === 9 ? compact.slice(3) : compact;
  return /^[A-HJKMNP-Z2-9]{6}$/.test(body) ? "AZO-" + body : null;
}

/** Lien personnel d'un commercial : la page de téléchargement, avec son code promo. */
export function referralLink(code: string, base: string = process.env.REFERRAL_LINK_BASE || "https://azo.angidsnpro.com/"): string {
  const root = base.includes("#") ? base.split("#")[0] : base;
  const sep = root.includes("?") ? "&" : "?";
  return `${root}${sep}ref=${encodeURIComponent(code)}#telecharger`;
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
