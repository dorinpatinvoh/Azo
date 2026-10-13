// Règles de saisie de l'inscription (après l'OTP) : nom, prénom, sexe et NPI.
// Le serveur revalide tout : ces contrôles évitent seulement un aller-retour inutile.

import type { MessageKey } from "../i18n/fr";

export type Gender = "M" | "F";

// `labelKey` : clé de traduction (i18n/*.ts), le texte dépend de la langue choisie.
export const GENDER_OPTIONS: { value: Gender; labelKey: MessageKey; icon: "male" | "female" }[] = [
  { value: "M", labelKey: "auth.gender.M", icon: "male" },
  { value: "F", labelKey: "auth.gender.F", icon: "female" },
];

// NPI : Numéro Personnel d'Identification (Bénin). 10 chiffres. À CONFIRMER avec la
// spécification officielle (ANIP) : une seule constante à changer si la longueur diffère.
export const NPI_LENGTH = 10;

const NAME_MIN = 2;
const NAME_MAX = 50;
// Lettres (accents compris), espaces, tiret et apostrophe : « Kossi », « Adjovi-Mensah »,
// « N'Dri ». Aucun chiffre ni symbole.
const NAME_PATTERN = /^[\p{L}][\p{L}\s'’-]*$/u;

/** Espaces superflus retirés, comme le fait le serveur avant de valider. */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidName(value: string): boolean {
  const name = normalizeName(value);
  return name.length >= NAME_MIN && name.length <= NAME_MAX && NAME_PATTERN.test(name);
}

/** Ne garde que les chiffres, tronqués à la longueur du NPI (copier-coller avec espaces). */
export function cleanNpi(value: string): string {
  return value.replace(/\D/g, "").slice(0, NPI_LENGTH);
}

export function isValidNpi(value: string): boolean {
  return cleanNpi(value).length === NPI_LENGTH;
}

/** Affichage groupé « 1234 5678 90 », plus lisible pour vérifier sa saisie. */
export function formatNpi(value: string): string {
  const d = cleanNpi(value);
  return [d.slice(0, 4), d.slice(4, 8), d.slice(8)].filter(Boolean).join(" ");
}

export type RegistrationInput = { lastName: string; firstName: string; gender: Gender | null; npi: string };

export type RegistrationProblem = { key: MessageKey; vars?: Record<string, string | number> };

/** Premier problème à signaler (clé de message à traduire), ou `null` si le formulaire est valide. */
export function registrationError(input: RegistrationInput): RegistrationProblem | null {
  if (!isValidName(input.lastName)) return { key: "reg.err.lastName" };
  if (!isValidName(input.firstName)) return { key: "reg.err.firstName" };
  if (!input.gender) return { key: "reg.err.gender" };
  if (!isValidNpi(input.npi)) return { key: "reg.err.npi", vars: { length: NPI_LENGTH } };
  return null;
}
