/**
 * Ajoute un crédit de TEST au portefeuille AZƆ̀ Pay d'un compte (client, agence…), avec une ligne dans l'historique.
 *
 *   node --env-file=.env scripts/credit-wallet.js 0195000000 20000
 *   node --env-file=.env scripts/credit-wallet.js 0195000000 20000 --allow-remote
 *
 * Le compte doit exister (il suffit qu'il se soit connecté une fois). Refuse une base non locale sans --allow-remote.
 */
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const [raw, rawAmount] = positional;
const amount = Number(rawAmount);
if (!raw || !Number.isInteger(amount) || amount <= 0) {
  console.error("Usage : node --env-file=.env scripts/credit-wallet.js <numéro> <montant en FCFA> [--allow-remote]");
  process.exit(1);
}
const url = process.env.DATABASE_URL || "";
if (!args.includes("--allow-remote") && !/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
  console.error("Refusé : DATABASE_URL ne vise pas une base locale. Ajoute --allow-remote seulement si tu veux vraiment créditer ce compte sur cette base (ex. Render).");
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
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) throw new Error(`Aucun compte pour ${phone} : connecte-toi une première fois dans l'application, puis relance.`);
  const wallet =
    (await prisma.wallet.findUnique({ where: { userId: user.id } })) ??
    (await prisma.wallet.create({ data: { userId: user.id, balance: 0, cashback: 0 } }));
  await prisma.$transaction([
    prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } }),
    prisma.transaction.create({
      data: { walletId: wallet.id, type: "CREDIT", status: "CONFIRMED", amount, label: "Crédit de test AZƆ̀", kind: "TEST" },
    }),
  ]);
  const fresh = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  console.log(`✔ ${phone} : +${amount.toLocaleString("fr-FR")} F — nouveau solde ${fresh.balance.toLocaleString("fr-FR")} F`);
}
main()
  .catch((e) => {
    console.error("ERREUR :", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
