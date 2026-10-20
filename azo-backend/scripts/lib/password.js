const { randomBytes, scryptSync, timingSafeEqual } = require("crypto");

// Mot de passe de la console web administrateur : scrypt avec sel aléatoire, jamais stocké en clair.
// Format enregistré : scrypt$N$sel(hex)$empreinte(hex). Même algorithme côté serveur (src/common/password.ts) et dans les scripts.
const N = 16384;
const KEYLEN = 64;

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [scheme, n, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !n || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length, { N: Number(n) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
