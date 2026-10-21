/**
 * Supprime un compte CLIENT (même règles que le bouton « Supprimer » de la console web).
 *
 *   $env:DATABASE_URL = "<adresse de la base>"
 *   node scripts/delete-client.js 0196531826 --allow-remote            (montre le compte, ne supprime rien)
 *   node scripts/delete-client.js 0196531826 --allow-remote --confirm  (supprime)
 *   ajouter --solder si le client a encore de l'argent : le solde est remis à zéro (écriture conservée dans l'historique)
 *
 * - Un client sans historique est effacé ; avec des courses, livraisons ou mouvements d'argent, il est ANONYMISÉ
 *   (historique conservé pour la comptabilité, nom, numéro et NPI effacés, numéro libéré).
 * - Refuse un compte qui n'est pas un simple client, un solde non nul, une course en cours.
 * - Refuse une base distante sans --allow-remote. Nécessite le dossier dist (npm run build).
 */
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const raw = args.find((a) => !a.startsWith("--"));
if (!raw) {
  console.error("Usage : node scripts/delete-client.js <numéro> [--allow-remote] [--confirm]");
  process.exit(1);
}
const url = process.env.DATABASE_URL || "";
if (!args.includes("--allow-remote") && !/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
  console.error("Refusé : DATABASE_URL ne vise pas une base locale. Ajoute --allow-remote seulement si tu veux vraiment agir sur cette base.");
  process.exit(1);
}

const digits = String(raw).replace(/\D/g, "");
const local = digits.startsWith("229") ? digits.slice(3) : digits;
const core = local.length === 10 && local.startsWith("01") ? local.slice(2) : local;
if (core.length !== 8) {
  console.error(`Numéro invalide : « ${raw} ». Attendu : 8 chiffres, ou 10 chiffres commençant par 01.`);
  process.exit(1);
}
// Le compte peut avoir été créé avec l'ancien format (8 chiffres) ou le nouveau (01 + 8 chiffres)
const variants = [`+22901${core}`, `+229${core}`];

let deleteClientAccount;
try {
  ({ deleteClientAccount } = require("../dist/src/admin/client-deletion.js"));
} catch {
  console.error("Dossier dist introuvable : lance d'abord « npm run build » dans azo-backend.");
  process.exit(1);
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { phone: { in: variants } },
      include: { wallet: { select: { balance: true } }, provider: { select: { id: true } } },
    });
    if (!user) {
      console.log(`Aucun compte trouvé pour ${variants.join(" ou ")} : rien à supprimer.`);
      return;
    }
    const [rides, deliveries] = await Promise.all([
      prisma.ride.count({ where: { clientId: user.id } }),
      prisma.delivery.count({ where: { clientId: user.id } }),
    ]);
    console.log(`Compte : ${user.phone} · ${user.fullName ?? "sans nom"} · rôle ${user.role} · statut ${user.status}`);
    console.log(`Solde : ${user.wallet?.balance ?? 0} F · courses : ${rides} · livraisons : ${deliveries}`);
    if (!args.includes("--confirm")) {
      console.log("\nRien n'a été supprimé. Relance avec --confirm pour supprimer ce compte.");
      return;
    }
    // L'identifiant de l'administrateur n'est qu'un repère pour le journal : aucun compte n'est ciblé par erreur
    const result = await deleteClientAccount(prisma, "script-delete-client", user.id, { settleBalance: args.includes("--solder") });
    console.log(result.mode === "deleted" ? "Compte supprimé." : "Compte anonymisé : historique conservé, données personnelles effacées, numéro libéré.");
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("Échec :", String(e.message).replace(/postgres(ql)?:\/\/\S+/g, "<url>"));
  process.exit(1);
});
