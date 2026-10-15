/**
 * Crée (ou complète) un compte PRESTATAIRE prêt à tester : Spider (Zem), conducteur de voiture ou coursier / livreur,
 * à partir d'un numéro de téléphone béninois.
 *
 *   node --env-file=.env scripts/create-provider.js 0197000301 --profile spider-essence
 *   node --env-file=.env scripts/create-provider.js 0197000304 --profile voiture --vehicle KOALA --balance 20000
 *   node --env-file=.env scripts/create-provider.js 0197000305 --profile livreur --allow-remote
 *
 * Profils (--profile) :
 *   spider-essence      Spider (Zem) à essence
 *   spider-electrique   Spider (Zem) électrique
 *   voiture             Conducteur de voiture ; --vehicle GAZELLE (défaut), KOALA ou LEOPARD
 *   coursier-express    Coursier express (plis urgents, petits paquets)
 *   coursier-personnel  Coursier personnel (courses, marché, pharmacie)
 *   livreur             Livreur de colis (double code OTP)
 *
 * Options : --name "<nom>" · --balance <F> (solde AZƆ̀ Pay, défaut 5 000) · --allow-remote (base non locale, ex. Render)
 * Le dossier est créé déjà APPROUVÉ : le compte entre directement dans son espace professionnel (connexion : numéro + code OTP).
 * Sans danger si relancé : un compte existant est complété, jamais dupliqué ; un solde déjà positif n'est pas modifié.
 */
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const valueOptions = ["profile", "vehicle", "name", "balance"].map((n) => `--${n}`);
const raw = args.find((a, i) => !a.startsWith("--") && !valueOptions.includes(args[i - 1]));

const PROFILES = {
  "spider-essence": { label: "Spider à essence", type: "DRIVER", vehicleType: "ZEM_ESSENCE", model: "Bajaj Boxer" },
  "spider-electrique": { label: "Spider électrique", type: "DRIVER", vehicleType: "ZEM_ELECTRIC", model: "Moto électrique" },
  voiture: { label: "Conducteur de voiture", type: "DRIVER", vehicleType: "GAZELLE", model: "Toyota Corolla" },
  "coursier-express": { label: "Coursier express", type: "COURIER", vehicleType: "GAZELLE", model: "Moto", categoryId: "COURSIER_EXPRESS" },
  "coursier-personnel": { label: "Coursier personnel", type: "COURIER", vehicleType: "GAZELLE", model: "Moto", categoryId: "COURSIER_PERSONNEL" },
  livreur: { label: "Livreur de colis", type: "COURIER", vehicleType: "KOALA", model: "Toyota Yaris", categoryId: "LIVREUR_COLIS" },
};

const profileKey = option("profile");
const profile = profileKey ? PROFILES[profileKey] : undefined;
if (!raw || !profile) {
  console.error(
    "Usage : node --env-file=.env scripts/create-provider.js <numéro> --profile <" + Object.keys(PROFILES).join("|") + '> [--vehicle GAZELLE|KOALA|LEOPARD] [--name "…"] [--balance 5000] [--allow-remote]'
  );
  process.exit(1);
}
if (profileKey === "voiture" && option("vehicle")) {
  const v = option("vehicle").toUpperCase();
  if (!["GAZELLE", "KOALA", "LEOPARD"].includes(v)) {
    console.error("--vehicle doit valoir GAZELLE, KOALA ou LEOPARD.");
    process.exit(1);
  }
  profile.vehicleType = v;
}

const url = process.env.DATABASE_URL || "";
if (!flag("allow-remote") && !/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
  console.error("Refusé : DATABASE_URL ne vise pas une base locale. Ajoute --allow-remote seulement si tu veux vraiment créer ce compte sur cette base (ex. Render).");
  process.exit(1);
}

// Même règle que src/common/phone.ts (normalizeBeninPhone)
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
const balance = option("balance") !== undefined ? Number(option("balance")) : 5000;
if (!Number.isFinite(balance) || balance < 0) {
  console.error("--balance doit être un nombre positif.");
  process.exit(1);
}
const fullName = option("name") || `Test ${profile.label}`;
const plate = "RB-" + phone.slice(-4) + "-AZ";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  let user = await prisma.user.findUnique({ where: { phone } });
  if (user && user.role !== "DRIVER" && user.role !== "CLIENT") {
    throw new Error(`Le numéro ${phone} appartient déjà à un compte ${user.role} : choisis un autre numéro.`);
  }
  if (!user) user = await prisma.user.create({ data: { phone, fullName, role: "DRIVER", status: "ACTIVE" } });
  else if (user.role !== "DRIVER" || user.status !== "ACTIVE") user = await prisma.user.update({ where: { id: user.id }, data: { role: "DRIVER", status: "ACTIVE" } });

  const existing = await prisma.providerProfile.findUnique({ where: { userId: user.id } });
  const data = {
    type: profile.type,
    status: "APPROVED",
    fullName,
    city: "Cotonou",
    vehicleType: profile.vehicleType,
    vehicleModel: profile.model,
    plateNumber: plate,
    ...(profile.categoryId ? { categoryId: profile.categoryId } : {}),
    activatedAt: now,
    reviewedAt: now,
  };
  if (!existing) await prisma.providerProfile.create({ data: { userId: user.id, ...data } });
  else await prisma.providerProfile.update({ where: { id: existing.id }, data });

  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) await prisma.wallet.create({ data: { userId: user.id, balance, cashback: 0 } });
  else if (wallet.balance === 0 && balance > 0) await prisma.wallet.update({ where: { userId: user.id }, data: { balance } });

  console.log(`✔ Compte prêt : ${profile.label} — ${phone} (${fullName}), véhicule ${profile.vehicleType}, plaque ${plate}`);
  console.log(`  Connexion dans l'application avec le numéro ${phone.slice(4).replace(/(\d{2})(?=\d)/g, "$1 ")} puis le code OTP. Solde AZƆ̀ Pay : ${balance.toLocaleString("fr-FR")} F.`);
}

main()
  .catch((e) => {
    console.error("ERREUR :", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
