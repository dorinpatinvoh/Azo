import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Mot de passe de la console web administrateur : scrypt avec sel aléatoire, jamais stocké en clair.
 * Format enregistré : scrypt$N$sel(hex)$empreinte(hex). Même algorithme que scripts/lib/password.js (création du compte).
 */
const N = 16384;
const KEYLEN = 64;
export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (typeof stored !== "string") return false;
  const [scheme, n, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !n || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length, { N: Number(n) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Vrai si le mot de passe est assez solide pour un administrateur : 10 caractères, une lettre et un chiffre. */
export function isStrongPassword(password: string): boolean {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH && /[A-Za-z]/.test(password) && /\d/.test(password);
}
