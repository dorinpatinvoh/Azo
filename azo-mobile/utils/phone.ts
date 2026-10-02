/**
 * Plan de numérotation nationale du Bénin (+229) à 10 chiffres :
 * "01" + 8 chiffres (ex. 01 97 00 00 42).
 */
export const BENIN_PHONE_LENGTH = 10;
export const BENIN_LOCAL_PHONE_LENGTH = 10;

/** Extrait au plus 10 chiffres locaux (retire +229 si l'utilisateur a collé le numéro complet). */
export function cleanBeninDigits(raw: string): string {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("00229") && digits.length > 5) {
    digits = digits.slice(5);
  } else if (digits.startsWith("229") && digits.length >= 11) {
    digits = digits.slice(3);
  }
  return digits.slice(0, BENIN_PHONE_LENGTH);
}

/** Formate la saisie en "01 97 00 00 42" (groupes de 2 chiffres). */
export function formatBeninPhoneInput(raw: string): string {
  const digits = cleanBeninDigits(raw);
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}
export const formatBeninLocalInput = formatBeninPhoneInput;

/** Convertit un numéro béninois en format E.164 (+22901XXXXXXXX). */
export function toBeninE164(raw: string): string {
  const digits = cleanBeninDigits(raw);
  return `+229${digits}`;
}

/** Valide un numéro béninois à 10 chiffres commençant par 01. */
export function isValidBeninPhone(raw: string): boolean {
  const digits = cleanBeninDigits(raw);
  return digits.length === BENIN_PHONE_LENGTH && digits.startsWith("01");
}

/** Affiche proprement un numéro stocké (+2290197000042 -> +229 01 97 00 00 42). */
export function formatBeninPhoneDisplay(phone?: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("229") && digits.length > 8 ? digits.slice(3) : digits;
  const spaced = local.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  return `+229 ${spaced}`;
}
