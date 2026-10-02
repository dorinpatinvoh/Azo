#!/usr/bin/env node
/**
 * Seed AZƆ̀ — administration et dossiers prestataires.
 *
 *   npm run seed                              crée le compte ADMIN + régularise l'existant
 *   npm run providers:list                    liste les comptes et leurs dossiers
 *   npm run providers:approve -- +22997000042 approuve le dossier d'un numéro (développement)
 *
 * Le compte ADMIN ne peut être créé QUE par ce script : aucune route de l'API ne permet
 * de s'attribuer le rôle ADMIN. Renseigne ADMIN_PHONE dans .env avant de lancer le seed.
 *
 * `providers:approve` existe pour ne pas bloquer tes tests tant que la console admin
 * (étape 3c) n'est pas dans l'app : il fait exactement ce que fera le bouton « Approuver »
 * d'un administrateur, et le journalise comme une action de script.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Rôle applicatif accordé à l'approbation d'un dossier (même table que providers.module.ts)
const ROLE_FOR_TYPE = { DRIVER: "DRIVER", COURIER: "DRIVER", AGENCY: "AGENCY", ARTISAN: "ARTISAN" };

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

/* -------------------------------------------------------------------------- */

async function ensureAdmin() {
  const phone = normalizePhone(process.env.ADMIN_PHONE);
  if (!phone) {
    console.warn(
      "\n⚠️  ADMIN_PHONE n'est pas défini dans azo-backend/.env : aucun administrateur créé.\n" +
        "   Sans compte ADMIN, personne ne peut valider les dossiers prestataires.\n" +
        "   Exemple :  ADMIN_PHONE=\"+2290197000000\"\n"
    );
    return null;
  }

  const variants = phoneVariants(process.env.ADMIN_PHONE);
  const existing = await prisma.user.findFirst({ where: { phone: { in: variants } } });
  if (existing) {
    const admin = await prisma.user.update({
      where: { id: existing.id },
      data: { phone, role: "ADMIN", status: "ACTIVE", fullName: existing.fullName ?? "Administrateur AZƆ̀" },
    });
    if (!(await prisma.wallet.findUnique({ where: { userId: admin.id } }))) {
      await prisma.wallet.create({ data: { userId: admin.id } });
    }
    console.log(`✔ Administrateur déjà présent, mis à jour : ${admin.phone} (${admin.id})`);
    return admin;
  }

  const admin = await prisma.user.create({
    data: {
      phone,
      fullName: "Administrateur AZƆ̀",
      role: "ADMIN",
      status: "ACTIVE",
      wallet: { create: {} },
    },
  });
  console.log(`✔ Administrateur créé : ${admin.phone} (${admin.id})`);
  console.log("  Connecte-toi dans l'app avec ce numéro : le code OTP s'affiche dans la console du backend.");
  return admin;
}

// Les comptes créés avant la mise en place des dossiers (rôle attribué à l'inscription)
// conservent leur accès : on leur rattache un dossier APPROVED avec un score KYC de 0,
// ce qui les fait remonter dans la console admin comme « à régulariser ».
async function backfillProviders() {
  const users = await prisma.user.findMany({
    where: { role: { in: ["DRIVER", "AGENCY", "ARTISAN"] }, provider: { is: null } },
  });
  for (const user of users) {
    const type = user.role === "AGENCY" ? "AGENCY" : user.role === "ARTISAN" ? "ARTISAN" : "DRIVER";
    await prisma.providerProfile.create({
      data: {
        userId: user.id,
        type,
        status: "APPROVED",
        zones: [],
        fullName: user.fullName ?? "Compte prestataire existant",
        activatedAt: user.createdAt,
        reviewedAt: user.createdAt,
        kycScore: 0,
        events: {
          create: {
            type: "APPROVED",
            comment: "Régularisation automatique : compte créé avant la gestion des dossiers (pièces à fournir)",
          },
        },
      },
    });
    console.log(`  ↳ dossier régularisé pour ${user.phone} (${type}, score KYC 0/100)`);
  }
  console.log(users.length ? `✔ ${users.length} compte(s) régularisé(s)` : "✔ Aucun compte à régulariser");
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
  console.log("\nTÉLÉPHONE        RÔLE      STATUT   DOSSIER            PIÈCES  AGENCE");
  console.log("─".repeat(78));
  for (const u of users) {
    const p = u.provider;
    console.log(
      [
        u.phone.padEnd(16),
        u.role.padEnd(9),
        u.status.padEnd(8),
        p ? `${p.type}/${p.status}`.padEnd(20) : "—".padEnd(20),
        p ? `${p.documents.length}`.padEnd(7) : "—".padEnd(7),
        u.agency ? u.agency.name : "—",
      ].join(" ")
    );
  }
  const waiting = await prisma.providerProfile.count({
    where: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "NEED_INFO"] } },
  });
  console.log(`\n${waiting} dossier(s) en attente de décision admin.`);
}

// Approbation manuelle d'un dossier — équivalent du bouton « Approuver » de la console.
async function approveProvider(rawPhone, forcedType) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    console.error("Usage : npm run providers:approve -- +22997000042 [DRIVER|AGENCY]");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { phone }, include: { provider: true } });
  if (!user) {
    console.error(
      `✖ Aucun compte AZƆ̀ pour ${phone}.\n` +
        "  Inscris d'abord ce numéro dans l'app (le code OTP s'affiche dans la console du backend)."
    );
    process.exitCode = 1;
    return;
  }

  const type = forcedType ? String(forcedType).toUpperCase() : user.provider?.type ?? "DRIVER";
  if (!["DRIVER", "AGENCY", "ARTISAN", "COURIER"].includes(type)) {
    console.error(`✖ Type de dossier invalide : ${type}`);
    process.exitCode = 1;
    return;
  }

  let provider = user.provider;
  if (!provider) {
    provider = await prisma.providerProfile.create({
      data: { userId: user.id, type, status: "DRAFT", zones: [] },
    });
    console.log(`  ↳ dossier ${type} créé pour ${phone}`);
  }
  if (provider.status === "APPROVED") {
    console.log(`✔ ${phone} est déjà approuvé (rôle ${user.role}).`);
    return;
  }

  const now = new Date();
  const role = ROLE_FOR_TYPE[type] ?? "DRIVER";

  let agencyId = provider.agencyId;
  if (type === "AGENCY") {
    // Même règle que l'approbation par l'admin : l'agence naît avec le dossier.
    // Formule PRO par défaut quand le dossier ne la précise pas encore.
    const plan = provider.plan ?? "PRO";
    const PLANS = {
      PRO: { fee: 45000, maxAccounts: 10, rate: 0.03 },
      ARGENT: { fee: 100000, maxAccounts: 25, rate: 0.025 },
      OR: { fee: 250000, maxAccounts: 100, rate: 0.02 },
      DIAMANT: { fee: 500000, maxAccounts: 1000, rate: 0.01 },
    };
    const agency = await prisma.agency.create({
      data: {
        name: provider.agencyName ?? `Agence ${phone.slice(-4)}`,
        plan,
        commissionRate: PLANS[plan].rate,
        maxAccounts: PLANS[plan].maxAccounts,
        activationFee: PLANS[plan].fee,
      },
    });
    agencyId = agency.id;
    console.log(`  ↳ agence créée : ${agency.name} (formule ${plan}, frais ${PLANS[plan].fee} F non débités)`);
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
        comment: "Approbation par script de développement (npm run providers:approve) — pièces non vérifiées",
      },
    }),
  ]);

  console.log(`\n✔ ${phone} est maintenant ${role}.`);
  console.log(
    "  L'API le voit immédiatement (le rôle est relu en base à chaque requête),\n" +
      "  mais l'app mobile route sur le rôle stocké à la connexion :\n" +
      "  déconnecte puis reconnecte ce numéro dans l'app pour ouvrir l'espace " +
      (role === "AGENCY" ? "agence" : "chauffeur") + "."
  );
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
    case undefined:
      console.log("Seed AZƆ̀…");
      await ensureAdmin();
      await backfillProviders();
      console.log("\nTerminé. Tape `npm run providers:list` pour voir les comptes.");
      break;
    default:
      console.error(`Commande inconnue : ${command}\nUsage : seed | list | approve <téléphone> [DRIVER|AGENCY]`);
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
