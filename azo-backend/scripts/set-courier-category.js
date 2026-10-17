/**
 * Change la spécialité d'un coursier déjà inscrit : coursier personnel ou livreur express.
 * Sert à corriger un dossier créé avant le correctif du 17/10/2026 (la spécialité choisie à l'inscription était remplacée par « livreur express »).
 *
 *   node --env-file=.env scripts/set-courier-category.js 0195000000 PERSONNEL
 *   node --env-file=.env scripts/set-courier-category.js 0195000000 EXPRESS --allow-remote
 *
 * Refuse une base non locale sans --allow-remote. Le compte doit avoir un dossier de type coursier.
 */
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const [raw, kind] = positional;
const categories = { PERSONNEL: "COURSIER_PERSONNEL", EXPRESS: "COURSIER_EXPRESS" };
const categoryId = categories[String(kind || "").toUpperCase()];
if (!raw || !categoryId) {
  console.error("Usage : node --env-file=.env scripts/set-courier-category.js <numéro> <PERSONNEL|EXPRESS> [--allow-remote]");
  process.exit(1);
}
const url = process.env.DATABASE_URL || "";
if (!args.includes("--allow-remote") && !/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
  console.error("Refusé : DATABASE_URL ne vise pas une base locale. Ajoute --allow-remote seulement si tu veux vraiment modifier ce compte sur cette base (ex. Render).");
  process.exit(1);
}
function normalize(input) {
  const digits = String(input).replace(/\D/g, "");
  const local = digits.startsWith("229") ? digits.slice(3) : digits;
  if (local.length === 8 && !local.startsWith("01")) return `+22901${local}`;
  if (local.length === 10 && local.startsWith("01")) return `+229${local}`;
  return null;
}
const phone = normalize(raw);
if (!phone) {
  console.error(`Numéro invalide : « ${raw} ».`);
  process.exit(1);
}

const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findUnique({ where: { phone }, include: { provider: true } });
  if (!user) throw new Error(`Aucun compte pour ${phone}.`);
  if (!user.provider || user.provider.type !== "COURIER") throw new Error(`${phone} n'a pas de dossier de coursier.`);
  const before = user.provider.categoryId;
  await prisma.providerProfile.update({ where: { id: user.provider.id }, data: { categoryId } });
  console.log(`${phone} : spécialité ${before ?? "(vide)"} → ${categoryId}. Véhicule du dossier : ${user.provider.vehicleType ?? "non renseigné"}.`);
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
