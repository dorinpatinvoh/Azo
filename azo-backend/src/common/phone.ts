/**
 * Numérotation béninoise (+229) à 10 chiffres : "01" suivi des 8 chiffres de l'abonné
 * (ex. 01 XX XX XX XX -> +22901XXXXXXXX).
 *
 * Pour ne casser aucun compte créé avant le passage à 10 chiffres, `beninPhoneVariants`
 * renvoie à la fois la forme canonique à 10 chiffres (+22901XXXXXXXX) et l'ancienne
 * forme à 8 chiffres (+229XXXXXXXX).
 */
export function extractLocalBeninDigits(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00229") && digits.length > 5) {
    return digits.slice(5);
  }
  if (digits.startsWith("229") && digits.length >= 11) {
    return digits.slice(3);
  }
  return digits;
}

export function normalizeBeninPhone(raw: string): string {
  const local = extractLocalBeninDigits(raw);
  if (!local) return "+229";
  // Si un numéro à 8 chiffres est fourni sans le préfixe 01, on le complète en 10 chiffres.
  if (local.length === 8 && !local.startsWith("01")) {
    return `+22901${local}`;
  }
  return `+229${local}`;
}

export function beninPhoneVariants(raw: string): string[] {
  const local = extractLocalBeninDigits(raw);
  if (!local) return [];
  const canonical = normalizeBeninPhone(raw);
  const set = new Set<string>([canonical, `+229${local}`]);
  if (local.length === 10 && local.startsWith("01")) {
    set.add(`+229${local.slice(2)}`);
  } else if (local.length === 8) {
    set.add(`+22901${local}`);
  }
  return Array.from(set);
}
