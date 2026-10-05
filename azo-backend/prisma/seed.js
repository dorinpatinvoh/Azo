#!/usr/bin/env node
/**
 * Seed AZƆ̀ — administration et dossiers prestataires (Bénin / Cotonou).
 *
 *   npm run seed                                crée/actualise l'ADMIN et purge les anciens comptes de test
 *   npm run providers:list                      liste les comptes et leurs dossiers
 *   npm run providers:approve -- +22901XXXXXXXX approuve le dossier d'un numéro
 *
 * Aucun compte de démonstration n'est créé : chaque utilisateur (client ou
 * prestataire) s'inscrit avec son propre numéro depuis l'application mobile.
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const ROLE_FOR_TYPE = {
  DRIVER: "DRIVER",
  COURIER: "DRIVER",
  AGENCY: "AGENCY",
  ARTISAN: "CLIENT",
};

// Grille officielle AZƆ̀ : lue depuis la configuration tarifaire (source unique),
// jamais recopiée ici. Les niveaux ne concernent QUE les agences.
const tarificationPath = [
  path.join(__dirname, "..", "src", "pricing", "tarification.json"),
  path.join(__dirname, "..", "dist", "pricing", "tarification.json"),
].find((candidate) => fs.existsSync(candidate));

if (!tarificationPath) {
  console.error("✖ Configuration tarifaire introuvable (src/pricing/tarification.json)");
  process.exit(1);
}

const tarification = JSON.parse(fs.readFileSync(tarificationPath, "utf8"));
const PLANS = Object.fromEntries(
  Object.entries(tarification.agencyLevels).map(([level, rules]) => [
    level,
    { fee: rules.activationFee, maxAccounts: rules.maxAccounts, rate: rules.commissionPct / 100 },
  ])
);

function extractLocalDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00229") && digits.length > 5) return digits.slice(5);
  if (digits.startsWith("229") && digits.length >= 11) return digits.slice(3);
  return digits;
}

function normalizePhone(raw) {
  const local = extractLocalDigits(raw);
  if (!local) return null;
  if (local.length === 8 && !local.startsWith("01")) return `+22901${local}`;
  return `+229${local}`;
}

function phoneVariants(raw) {
  const local = extractLocalDigits(raw);
  if (!local) return [];
  const canonical = normalizePhone(raw);
  const set = new Set([canonical, `+229${local}`]);
  if (local.length === 10 && local.startsWith("01")) set.add(`+229${local.slice(2)}`);
  else if (local.length === 8) set.add(`+22901${local}`);
  return Array.from(set);
}

async function upsertUserWithWallet({ phone, fullName, role, status = "ACTIVE", balance = 0, cashback = 0, agencyId = null }) {
  const variants = phoneVariants(phone);
  const existing = await prisma.user.findFirst({ where: { phone: { in: variants } } });
  let user;
  if (existing) {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        phone,
        fullName,
        role,
        status,
        ...(agencyId ? { agencyId } : {}),
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        phone,
        fullName,
        role,
        status,
        ...(agencyId ? { agencyId } : {}),
      },
    });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) {
    await prisma.wallet.create({
      data: { userId: user.id, balance, cashback },
    });
  } else if (wallet.balance === 0 && balance > 0) {
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { balance, cashback },
    });
  }
  return user;
}

/* -------------------------------------------------------------------------- */

async function ensureAdmin() {
  const rawAdminPhone = process.env.ADMIN_PHONE || "+2290197000000";
  const phone = normalizePhone(rawAdminPhone);
  const admin = await upsertUserWithWallet({
    phone,
    fullName: "Direction Générale AZƆ̀ Bénin",
    role: "ADMIN",
    status: "ACTIVE",
    balance: 150000,
    cashback: 0,
  });
  console.log(`✔ Compte ADMIN prêt : ${admin.phone} (${admin.fullName})`);
  return admin;
}

/* -------------------------------------------------------------------------- */

// Anciens numéros de test livrés avec le seed d'origine : ils ne doivent plus
// exister en base. Seul le compte ADMIN (ADMIN_PHONE) est conservé.
const LEGACY_DEMO_PHONES = [
  "+2290197000042", // client de démonstration
  "+2290197000001", // zem / chauffeur indépendant
  "+2290197000002", // conducteur de flotte
  "+2290197000003", // conducteur de flotte
  "+2290197000004", // coursier / livreur
  "+2290197000010", // agence de démonstration
  "+2290196112233", // dossier KYC en attente
  "+2290196445566", // dossier KYC en attente
  "+2290196778899", // dossier KYC en attente
];

const LEGACY_DEMO_AGENCY_NAMES = [
  "Atlantique Mobilité & Flotte Cotonou SARL",
  "Cotonou Flotte Express SARL",
  "Bénin Express Logistique SARL",
];

// Supprime les comptes de démonstration et leurs données (courses, livraisons,
// portefeuille, dossier prestataire, agences). Ne touche jamais un ADMIN.
async function purgeLegacyDemoData() {
  let removed = 0;

  for (const rawPhone of LEGACY_DEMO_PHONES) {
    const variants = phoneVariants(rawPhone);
    const users = await prisma.user.findMany({
      where: { phone: { in: variants }, role: { not: "ADMIN" } },
      select: { id: true },
    });
    for (const user of users) {
      await prisma.$transaction([
        prisma.transaction.deleteMany({ where: { wallet: { userId: user.id } } }),
        prisma.notification.deleteMany({ where: { userId: user.id } }),
        prisma.ride.deleteMany({ where: { OR: [{ clientId: user.id }, { driverId: user.id }] } }),
        prisma.delivery.deleteMany({ where: { clientId: user.id } }),
        prisma.rentalBooking.deleteMany({ where: { clientId: user.id } }),
        prisma.marketplaceOrder.deleteMany({ where: { clientId: user.id } }),
        prisma.artisanRequest.deleteMany({ where: { clientId: user.id } }),
        prisma.providerProfile.deleteMany({ where: { userId: user.id } }),
        prisma.wallet.deleteMany({ where: { userId: user.id } }),
        prisma.otpCode.deleteMany({ where: { phone: { in: variants } } }),
        prisma.user.delete({ where: { id: user.id } }),
      ]);
      removed += 1;
    }
  }

  for (const name of LEGACY_DEMO_AGENCY_NAMES) {
    const agency = await prisma.agency.findFirst({ where: { name } });
    if (!agency) continue;
    const [users, providers] = await Promise.all([
      prisma.user.count({ where: { agencyId: agency.id } }),
      prisma.providerProfile.count({ where: { agencyId: agency.id } }),
    ]);
    if (users === 0 && providers === 0) {
      await prisma.agency.delete({ where: { id: agency.id } });
    }
  }

  if (removed > 0) {
    console.log(`✔ ${removed} ancien(s) compte(s) de démonstration supprimé(s).`);
  }
}

// Régularise d'éventuels anciens comptes créés avant la gestion des dossiers
async function backfillProviders() {
  const users = await prisma.user.findMany({
    where: { role: { in: ["DRIVER", "AGENCY"] }, provider: { is: null } },
  });
  for (const user of users) {
    const type = user.role === "AGENCY" ? "AGENCY" : "DRIVER";
    await prisma.providerProfile.create({
      data: {
        userId: user.id,
        type,
        status: "APPROVED",
        zones: ["Cotonou"],
        fullName: user.fullName ?? "Prestataire AZƆ̀",
        city: "Cotonou",
        activatedAt: user.createdAt,
        reviewedAt: user.createdAt,
        kycScore: 100,
        events: {
          create: {
            type: "APPROVED",
            comment: "Compte prestataire régularisé automatiquement",
          },
        },
      },
    });
  }
}

/* -------------------------------------------------------------------------- */

async function listProviders() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { provider: { include: { documents: true } }, agency: true },
  });
  if (users.length === 0) {
    console.log("Aucun compte en base.");
    return;
  }
  console.log("\nTÉLÉPHONE          RÔLE      STATUT   DOSSIER              PIÈCES  NOM / AGENCE");
  console.log("─".repeat(86));
  for (const u of users) {
    const p = u.provider;
    console.log(
      [
        u.phone.padEnd(18),
        u.role.padEnd(9),
        u.status.padEnd(8),
        p ? `${p.type}/${p.status}`.padEnd(20) : "—".padEnd(20),
        p ? `${p.documents.length}`.padEnd(7) : "—".padEnd(7),
        u.agency ? `${u.fullName || ""} (${u.agency.name})` : u.fullName || "—",
      ].join(" ")
    );
  }
}

async function approveProvider(rawPhone, forcedType) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    console.error("Usage : npm run providers:approve -- +22901XXXXXXXX [DRIVER|COURIER|AGENCY]");
    process.exitCode = 1;
    return;
  }

  const variants = phoneVariants(rawPhone);
  const user = await prisma.user.findFirst({
    where: { phone: { in: variants } },
    include: { provider: true },
  });
  if (!user) {
    console.error(`✖ Aucun compte AZƆ̀ pour ${phone}.`);
    process.exitCode = 1;
    return;
  }

  const type = forcedType ? String(forcedType).toUpperCase() : user.provider?.type ?? "DRIVER";
  if (!["DRIVER", "AGENCY", "COURIER"].includes(type)) {
    console.error(`✖ Type de dossier invalide : ${type} (attendu : DRIVER, COURIER ou AGENCY)`);
    process.exitCode = 1;
    return;
  }

  let provider = user.provider;
  if (!provider) {
    provider = await prisma.providerProfile.create({
      data: { userId: user.id, type, status: "DRAFT", zones: ["Cotonou"], city: "Cotonou" },
    });
  }
  if (provider.status === "APPROVED") {
    console.log(`✔ ${user.phone} est déjà approuvé (rôle ${user.role}).`);
    return;
  }

  const now = new Date();
  const role = ROLE_FOR_TYPE[type] ?? "DRIVER";

  let agencyId = provider.agencyId;
  if (type === "AGENCY") {
    const plan = provider.plan ?? "PRO";
    const agency = await prisma.agency.create({
      data: {
        name: provider.agencyName ?? `Agence ${user.phone.slice(-4)}`,
        plan,
        commissionRate: PLANS[plan].rate,
        maxAccounts: PLANS[plan].maxAccounts,
        activationFee: PLANS[plan].fee,
      },
    });
    agencyId = agency.id;
    console.log(
      `  ↳ agence créée : ${agency.name} (formule ${plan}, activation ${PLANS[plan].fee.toLocaleString("fr-FR")} FCFA)`
    );
  }

  await prisma.$transaction([
    prisma.providerProfile.update({
      where: { id: provider.id },
      data: {
        status: "APPROVED",
        type,
        submittedAt: provider.submittedAt ?? now,
        reviewedAt: now,
        activatedAt: now,
        rejectReason: null,
        suspensionReason: null,
        infoRequested: null,
        agencyId,
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { role, status: "ACTIVE", ...(agencyId ? { agencyId } : {}) },
    }),
    prisma.providerEvent.create({
      data: {
        providerId: provider.id,
        type: "APPROVED",
        comment: "Approbation par script (npm run providers:approve)",
      },
    }),
  ]);

  console.log(`\n✔ ${user.phone} est maintenant approuvé (${type} -> rôle ${role}).`);
}

/* -------------------------------------------------------------------------- */

async function main() {
  const [command, arg1, arg2] = process.argv.slice(2);

  switch (command) {
    case "list":
      await listProviders();
      break;
    case "approve":
      await approveProvider(arg1, arg2);
      break;
    case undefined: {
      console.log("Initialisation des données AZƆ̀ Bénin…");
      await ensureAdmin();
      // Les anciens comptes de démonstration (numéros de test) sont retirés de la base.
      await purgeLegacyDemoData();
      await backfillProviders();
      console.log("\nTerminé. Tape `npm run providers:list` pour voir tous les comptes prêts.");
      break;
    }
    default:
      console.error(`Commande inconnue : ${command}\nUsage : seed | list | approve <téléphone> [DRIVER|COURIER|AGENCY]`);
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("✖ Seed en échec :", e.message);
    if (/Can't reach database|P1001/.test(String(e.message))) {
      console.error("  PostgreSQL n'est pas joignable : vérifie DATABASE_URL dans azo-backend/.env");
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
