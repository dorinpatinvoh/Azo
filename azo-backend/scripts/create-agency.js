/**
 * Crée (ou complète) un compte AGENCE prêt à tester l'espace agence, à partir d'un numéro de téléphone béninois.
 *
 *   node --env-file=.env scripts/create-agency.js 0197000200
 *   node --env-file=.env scripts/create-agency.js 0197000200 --name "Flotte du Patron" --plan SILVER --balance 300000 --activated --with-drivers
 *
 * Options :
 *   --name "<nom>"     raison sociale de l'agence (défaut : « Agence Test AZƆ̀ »)
 *   --owner "<nom>"    nom du gérant (défaut : « Gérant Agence Test »)
 *   --plan <niveau>    PRO (défaut), SILVER, OR ou DIAMANT : frais d'activation, commission et plafond viennent de tarification.json
 *   --balance <F>      solde AZƆ̀ Pay du gérant (défaut : de quoi payer l'activation du niveau + 50 000 F)
 *   --activated        agence DÉJÀ activée (frais réglés). Sans cela, le testeur voit et paie l'activation lui-même.
 *   --with-drivers     crée aussi deux Zem approuvés (0197000101 et 0197000102) que l'agence peut rattacher par numéro
 *   --allow-remote     nécessaire si DATABASE_URL ne vise pas une base locale (ex. la base de production sur Render)
 *
 * - Sans danger si relancé : un compte existant est complété, jamais dupliqué ; un solde déjà positif n'est pas modifié.
 * - Connexion dans l'application : numéro de l'agence, puis code OTP (affiché dans la bannière de l'application).
 * - Le rôle AGENCY ne peut être donné que par ce script, `npm run seed` ou l'approbation d'un dossier par un administrateur.
 */
const { PrismaClient } = require("@prisma/client");
const levels = require("../src/pricing/tarification.json").agencyLevels;

const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
}
const flag = (name) => args.includes(`--${name}`);
const valueOptions = ["name", "owner", "plan", "balance"].map((n) => `--${n}`);
const raw = args.find((a, i) => !a.startsWith("--") && !valueOptions.includes(args[i - 1]));

if (!raw) {
  console.error('Usage : node --env-file=.env scripts/create-agency.js <numéro> [--name "…"] [--plan PRO|SILVER|OR|DIAMANT] [--balance 150000] [--activated] [--with-drivers] [--allow-remote]');
  process.exit(1);
}

const url = process.env.DATABASE_URL || "";
if (!flag("allow-remote") && !/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
  console.error("Refusé : DATABASE_URL ne vise pas une base locale. Ajoute --allow-remote seulement si tu veux vraiment créer cette agence sur cette base (ex. Render).");
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
const plan = (option("plan") || "PRO").toUpperCase();
const level = levels[plan];
if (!level) {
  console.error(`Niveau inconnu : « ${plan} ». Choix : ${Object.keys(levels).join(", ")}.`);
  process.exit(1);
}
const agencyName = option("name") || "Agence Test AZƆ̀";
const ownerName = option("owner") || "Gérant Agence Test";
const balance = option("balance") !== undefined ? Number(option("balance")) : level.activationFee + 50000;
if (!Number.isFinite(balance) || balance < 0) {
  console.error("--balance doit être un nombre positif.");
  process.exit(1);
}
const activated = flag("activated");

const prisma = new PrismaClient();

async function ensureWallet(userId, amount) {
  const existing = await prisma.wallet.findUnique({ where: { userId } });
  if (!existing) return prisma.wallet.create({ data: { userId, balance: amount, cashback: 0 } });
  if (existing.balance === 0 && amount > 0) return prisma.wallet.update({ where: { userId }, data: { balance: amount } });
  return existing;
}

async function main() {
  const now = new Date();

  // --- Gérant (rôle AGENCY) ---
  let owner = await prisma.user.findUnique({ where: { phone } });
  if (owner && owner.role !== "AGENCY" && owner.role !== "CLIENT") {
    throw new Error(`Le numéro ${phone} appartient déjà à un compte ${owner.role} : choisis un autre numéro.`);
  }
  if (!owner) {
    owner = await prisma.user.create({ data: { phone, fullName: ownerName, role: "AGENCY", status: "ACTIVE" } });
  } else if (owner.role !== "AGENCY" || owner.status !== "ACTIVE") {
    owner = await prisma.user.update({ where: { id: owner.id }, data: { role: "AGENCY", status: "ACTIVE" } });
  }

  // --- Agence ---
  let agencyId = owner.agencyId;
  if (!agencyId) {
    const agency = await prisma.agency.create({
      data: {
        name: agencyName,
        plan,
        commissionRate: level.commissionPct / 100,
        maxAccounts: level.maxAccounts,
        activationFee: level.activationFee,
        ...(activated ? { feePaidAt: now } : {}),
      },
    });
    agencyId = agency.id;
    await prisma.user.update({ where: { id: owner.id }, data: { agencyId } });
  } else if (activated) {
    await prisma.agency.update({ where: { id: agencyId }, data: { feePaidAt: now } });
  }

  // --- Dossier prestataire approuvé ---
  const profile = await prisma.providerProfile.findUnique({ where: { userId: owner.id } });
  if (!profile) {
    await prisma.providerProfile.create({
      data: {
        userId: owner.id, type: "AGENCY", status: "APPROVED", fullName: ownerName, city: "Cotonou",
        agencyName, plan, agencyId, activatedAt: now, reviewedAt: now,
      },
    });
  } else if (profile.status !== "APPROVED") {
    await prisma.providerProfile.update({ where: { id: profile.id }, data: { status: "APPROVED", reviewedAt: now, agencyId, type: "AGENCY" } });
  }

  await ensureWallet(owner.id, balance);

  const local = phone.slice(4).replace(/(\d{2})(?=\d)/g, "$1 ");
  console.log(`✔ Agence prête : « ${agencyName} » (niveau ${plan}, plafond ${level.maxAccounts} comptes)`);
  console.log(`  Gérant : ${phone} — connexion dans l'application avec le numéro ${local} puis le code OTP.`);
  console.log(`  Solde AZƆ̀ Pay du gérant : ${balance.toLocaleString("fr-FR")} F · ${activated ? "agence déjà activée" : `activation à payer : ${level.activationFee.toLocaleString("fr-FR")} F (le testeur le fait dans l'application)`}`);

  // --- Conducteurs Zem à rattacher (facultatif) ---
  if (flag("with-drivers")) {
    const drivers = [
      { phone: "+2290197000101", fullName: "Romaric Soglo", plate: "RB-1001-AX", balance: 10000 },
      { phone: "+2290197000102", fullName: "Koffi Adjovi", plate: "RB-1002-AX", balance: 0 },
    ];
    for (const d of drivers) {
      let user = await prisma.user.findUnique({ where: { phone: d.phone } });
      if (!user) user = await prisma.user.create({ data: { phone: d.phone, fullName: d.fullName, role: "DRIVER", status: "ACTIVE" } });
      const p = await prisma.providerProfile.findUnique({ where: { userId: user.id } });
      if (!p) {
        await prisma.providerProfile.create({
          data: {
            userId: user.id, type: "DRIVER", status: "APPROVED", fullName: d.fullName, city: "Cotonou",
            vehicleType: "ZEM_ESSENCE", vehicleModel: "Bajaj Boxer", plateNumber: d.plate, activatedAt: now, reviewedAt: now,
          },
        });
      }
      await ensureWallet(user.id, d.balance);
      console.log(`  Zem à rattacher par numéro : ${d.phone.slice(4)} (${d.fullName})`);
    }
  }
}

main()
  .catch((e) => {
    console.error("ERREUR :", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
