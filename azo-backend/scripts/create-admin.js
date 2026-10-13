/**
 * Crée (ou promeut) un compte ADMINISTRATEUR à partir d'un numéro de téléphone béninois.
 *
 *   node --env-file=.env scripts/create-admin.js 90000000
 *
 * - Le numéro est normalisé comme à la connexion : `90000000` (8 chiffres) devient le compte 01 90 00 00 00 (+2290190000000).
 * - Sans danger si relancé : le compte existant est mis à jour, jamais dupliqué.
 * - Refuse de s'exécuter si DATABASE_URL ne vise pas une base locale, sauf avec --allow-remote (à utiliser en connaissance de
 *   cause : cela crée un administrateur dans la base visée, par exemple celle de production).
 * - Le rôle ADMIN ne peut être donné que par ce script ou par `npm run seed` : aucune route de l'API ne le permet.
 */
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const allowRemote = args.includes("--allow-remote");
const raw = args.find((a) => !a.startsWith("--"));
if (!raw) {
  console.error("Usage : node --env-file=.env scripts/create-admin.js <numéro> [--allow-remote]");
  process.exit(1);
}

const url = process.env.DATABASE_URL || "";
if (!allowRemote && !/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
  console.error("Refusé : DATABASE_URL ne vise pas une base locale. Ajoute --allow-remote seulement si tu veux vraiment créer un administrateur sur cette base.");
  process.exit(1);
}

// Même règle que src/common/phone.ts (normalizeBeninPhone) : 8 chiffres sans « 01 » → on complète en 10 chiffres
function normalize(input) {
  const digits = String(input).replace(/\D/g, "");
  const local = digits.startsWith("229") ? digits.slice(3) : digits;
  if (local.length === 8 && !local.startsWith("01")) return `+22901${local}`;
  if (local.length === 10 && local.startsWith("01")) return `+229${local}`;
  return null;
}

const phone = normalize(raw);
if (!phone) {
  console.error(`Numéro invalide : « ${raw} ». Attendu : 8 chiffres, ou 10 chiffres commençant par 01.`);
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { phone } });
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN", status: "ACTIVE" } })
    : await prisma.user.create({ data: { phone, fullName: "Administrateur AZƆ̀", role: "ADMIN", status: "ACTIVE" } });
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) await prisma.wallet.create({ data: { userId: user.id, balance: 0, cashback: 0 } });

  const local = phone.slice(4);
  console.log(`✔ Administrateur ${existing ? "mis à jour" : "créé"} : ${phone}`);
  console.log(`  Connexion dans l'application avec le numéro ${local.replace(/(\d{2})(?=\d)/g, "$1 ")} (le code OTP s'affiche dans la bannière de l'application).`);
}

main()
  .catch((e) => {
    console.error("ERREUR :", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
