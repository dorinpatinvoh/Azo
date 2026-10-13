/**
 * Données de TEST pour essayer l'espace agence en local (aucune donnée de production).
 *
 *   node --env-file=.env scripts/seed-agency-test.js
 *
 * Crée, sans doublon si relancé :
 *   - une agence « Flotte Test Cotonou », niveau Pro, NON activée, dont le gérant a 150 000 F (de quoi payer l'activation
 *     de 100 000 F puis recharger des chauffeurs) ;
 *   - deux conducteurs Zem approuvés, pas encore rattachés (l'agence les ajoute par numéro dans l'application) ;
 *   - le compte administrateur n'est PAS touché (voir `npm run seed`).
 *
 * Connexion dans l'application : numéro puis code OTP affiché par le serveur.
 * Refuse de s'exécuter si DATABASE_URL ne vise pas une base locale.
 */
const { PrismaClient } = require("@prisma/client");

const url = process.env.DATABASE_URL || "";
if (!/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
  console.error("Refusé : DATABASE_URL ne vise pas une base locale (localhost). Aucune donnée créée.");
  process.exit(1);
}

const prisma = new PrismaClient();

const OWNER = { phone: "+2290197000100", fullName: "Gérant Flotte Test", balance: 150000 };
const DRIVERS = [
  { phone: "+2290197000101", fullName: "Romaric Soglo", plate: "RB-1001-AX", balance: 10000 },
  { phone: "+2290197000102", fullName: "Koffi Adjovi", plate: "RB-1002-AX", balance: 0 },
];

async function wallet(userId, balance) {
  const existing = await prisma.wallet.findUnique({ where: { userId } });
  if (!existing) return prisma.wallet.create({ data: { userId, balance, cashback: 0 } });
  if (existing.balance === 0 && balance > 0) return prisma.wallet.update({ where: { userId }, data: { balance } });
  return existing;
}

async function main() {
  // --- Gérant + agence
  let owner = await prisma.user.findUnique({ where: { phone: OWNER.phone } });
  if (!owner) {
    owner = await prisma.user.create({
      data: { phone: OWNER.phone, fullName: OWNER.fullName, role: "AGENCY", status: "ACTIVE" },
    });
  }
  let agencyId = owner.agencyId;
  if (!agencyId) {
    const agency = await prisma.agency.create({
      data: { name: "Flotte Test Cotonou", plan: "PRO", commissionRate: 0.03, maxAccounts: 10, activationFee: 100000 },
    });
    agencyId = agency.id;
    await prisma.user.update({ where: { id: owner.id }, data: { agencyId } });
  }
  const ownerProfile = await prisma.providerProfile.findUnique({ where: { userId: owner.id } });
  if (!ownerProfile) {
    await prisma.providerProfile.create({
      data: {
        userId: owner.id, type: "AGENCY", status: "APPROVED", fullName: OWNER.fullName, city: "Cotonou",
        agencyName: "Flotte Test Cotonou", plan: "PRO", agencyId, activatedAt: new Date(), reviewedAt: new Date(),
      },
    });
  }
  await wallet(owner.id, OWNER.balance);
  console.log(`✔ Agence prête : gérant ${OWNER.phone} (Pro, non activée, solde ${OWNER.balance.toLocaleString("fr-FR")} F)`);

  // --- Conducteurs approuvés (non rattachés)
  for (const d of DRIVERS) {
    let user = await prisma.user.findUnique({ where: { phone: d.phone } });
    if (!user) {
      user = await prisma.user.create({ data: { phone: d.phone, fullName: d.fullName, role: "DRIVER", status: "ACTIVE" } });
    }
    const profile = await prisma.providerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      await prisma.providerProfile.create({
        data: {
          userId: user.id, type: "DRIVER", status: "APPROVED", fullName: d.fullName, city: "Cotonou",
          vehicleType: "ZEM_ESSENCE", vehicleModel: "Bajaj Boxer", plateNumber: d.plate,
          activatedAt: new Date(), reviewedAt: new Date(),
        },
      });
    }
    await wallet(user.id, d.balance);
    console.log(`✔ Conducteur prêt : ${d.phone} (${d.fullName}), solde ${d.balance.toLocaleString("fr-FR")} F`);
  }
}

main()
  .catch((e) => {
    console.error("ERREUR :", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
