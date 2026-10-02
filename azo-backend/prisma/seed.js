#!/usr/bin/env node
/**
 * Seed AZƆ̀ — administration, dossiers prestataires et jeu de données réaliste (Bénin / Cotonou).
 *
 *   npm run seed                                crée l'ADMIN + données réalistes de démonstration
 *   npm run providers:list                      liste les comptes et leurs dossiers
 *   npm run providers:approve -- +2290197000042 approuve le dossier d'un numéro
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

// Nouvelle grille officielle AZƆ̀
const PLANS = {
  PRO: { fee: 100000, maxAccounts: 10, rate: 0.03 },
  ARGENT: { fee: 215500, maxAccounts: 25, rate: 0.025 },
  OR: { fee: 450500, maxAccounts: 100, rate: 0.02 },
  DIAMANT: { fee: 600500, maxAccounts: 1000, rate: 0.01 },
};

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

// Crée une petite image PNG valide sur disque pour que les pièces des dossiers de démo
// s'ouvrent réellement en plein écran dans la console Admin.
function ensureSampleDocumentImage() {
  const relDir = path.join("providers", "demo");
  const absDir = path.join(__dirname, "..", "uploads", relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const fileName = "piece-kyc-azo.png";
  const absFile = path.join(absDir, fileName);
  if (!fs.existsSync(absFile)) {
    // PNG émeraude 1x1 valide encodé en base64
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    fs.writeFileSync(absFile, Buffer.from(pngBase64, "base64"));
  }
  return `${relDir}/${fileName}`;
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

async function seedRealisticEcosystem(adminUser) {
  const sampleDocPath = ensureSampleDocumentImage();
  const now = new Date();
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600 * 1000);
  const daysAgo = (d) => new Date(now.getTime() - d * 24 * 3600 * 1000);
  const inTwoYears = new Date(now.getTime() + 730 * 24 * 3600 * 1000);

  // 1. Client réaliste (numéro par défaut de l'écran de connexion : 01 97 00 00 42)
  const client = await upsertUserWithWallet({
    phone: "+2290197000042",
    fullName: "Kossi Boris Adjovi",
    role: "CLIENT",
    status: "ACTIVE",
    balance: 48500,
    cashback: 1250,
  });

  // 2. Agence validée (Formule OR : 450 500 FCFA, 100 comptes, commission 2 %)
  let mainAgency = await prisma.agency.findFirst({
    where: { name: "Atlantique Mobilité & Flotte Cotonou SARL" },
  });
  if (!mainAgency) {
    mainAgency = await prisma.agency.create({
      data: {
        name: "Atlantique Mobilité & Flotte Cotonou SARL",
        plan: "OR",
        commissionRate: PLANS.OR.rate,
        maxAccounts: PLANS.OR.maxAccounts,
        activationFee: PLANS.OR.fee,
        feePaidAt: daysAgo(15),
      },
    });
  } else {
    mainAgency = await prisma.agency.update({
      where: { id: mainAgency.id },
      data: {
        plan: "OR",
        commissionRate: PLANS.OR.rate,
        maxAccounts: PLANS.OR.maxAccounts,
        activationFee: PLANS.OR.fee,
      },
    });
  }

  const agencyOwner = await upsertUserWithWallet({
    phone: "+2290197000010",
    fullName: "Sènakpon Rodrigue Ahouandjinou",
    role: "AGENCY",
    status: "ACTIVE",
    balance: 285000,
    agencyId: mainAgency.id,
  });

  await upsertApprovedProvider({
    user: agencyOwner,
    type: "AGENCY",
    fullName: "Sènakpon Rodrigue Ahouandjinou",
    city: "Cotonou",
    zones: ["Ganhi", "Haie Vive", "Akpakpa", "Cadjèhoun", "Fidjrossè"],
    agencyName: "Atlantique Mobilité & Flotte Cotonou SARL",
    plan: "OR",
    agencyId: mainAgency.id,
    rating: 4.9,
    jobsCompleted: 58,
    docKinds: ["CNI", "SELFIE", "RCCM", "IFU", "STATUTS"],
    sampleDocPath,
    inTwoYears,
    adminId: adminUser?.id,
  });

  // 3. Zem indépendant validé (01 97 00 00 01)
  const zemDriver = await upsertUserWithWallet({
    phone: "+2290197000001",
    fullName: "Romaric Soglo",
    role: "DRIVER",
    status: "ACTIVE",
    balance: 34200,
  });

  await upsertApprovedProvider({
    user: zemDriver,
    type: "DRIVER",
    fullName: "Romaric Soglo",
    city: "Cotonou",
    zones: ["Haie Vive", "Cadjèhoun", "Ganhi", "Akpakpa", "Étoile Rouge"],
    vehicleType: "ZEM",
    vehicleModel: "Haojue DK 150",
    plateNumber: "BJ-4821-AA",
    experienceYears: 5,
    rating: 4.9,
    jobsCompleted: 42,
    docKinds: ["CNI", "SELFIE", "PERMIS", "CARTE_GRISE", "ASSURANCE", "PHOTO_VEHICULE"],
    sampleDocPath,
    inTwoYears,
    adminId: adminUser?.id,
  });

  // 4. Deux conducteurs rattachés à l'agence Atlantique Mobilité
  const fleetDriver1 = await upsertUserWithWallet({
    phone: "+2290197000002",
    fullName: "Coffi Narcisse Dossou",
    role: "DRIVER",
    status: "ACTIVE",
    balance: 29500,
    agencyId: mainAgency.id,
  });

  await upsertApprovedProvider({
    user: fleetDriver1,
    type: "DRIVER",
    fullName: "Coffi Narcisse Dossou",
    city: "Cotonou",
    zones: ["Fidjrossè", "Cadjèhoun", "Place du Souvenir", "Camp Guézo"],
    vehicleType: "ZEM_ELECTRIC",
    vehicleModel: "Spiro Mauto Électrique",
    plateNumber: "BJ-9104-RB",
    experienceYears: 3,
    agencyId: mainAgency.id,
    rating: 4.8,
    jobsCompleted: 31,
    docKinds: ["CNI", "SELFIE", "PERMIS", "CARTE_GRISE", "ASSURANCE", "PHOTO_VEHICULE"],
    sampleDocPath,
    inTwoYears,
    adminId: adminUser?.id,
  });

  const fleetDriver2 = await upsertUserWithWallet({
    phone: "+2290197000003",
    fullName: "Ulrich Houngbédji",
    role: "DRIVER",
    status: "ACTIVE",
    balance: 64000,
    agencyId: mainAgency.id,
  });

  await upsertApprovedProvider({
    user: fleetDriver2,
    type: "DRIVER",
    fullName: "Ulrich Houngbédji",
    city: "Cotonou",
    zones: ["Aéroport Cotonou", "Haie Vive", "Novotel", "Ganhi"],
    vehicleType: "CAR",
    vehicleModel: "Toyota Corolla Climatisée",
    plateNumber: "BJ-2319-AB",
    experienceYears: 7,
    agencyId: mainAgency.id,
    rating: 4.9,
    jobsCompleted: 27,
    docKinds: ["CNI", "SELFIE", "PERMIS", "CARTE_GRISE", "ASSURANCE", "PHOTO_VEHICULE"],
    sampleDocPath,
    inTwoYears,
    adminId: adminUser?.id,
  });

  // 5. Coursier / Livreur validé (01 97 00 00 04)
  const courierUser = await upsertUserWithWallet({
    phone: "+2290197000004",
    fullName: "Fifamè Arnaud Zinsou",
    role: "DRIVER",
    status: "ACTIVE",
    balance: 21800,
    agencyId: mainAgency.id,
  });

  await upsertApprovedProvider({
    user: courierUser,
    type: "COURIER",
    fullName: "Fifamè Arnaud Zinsou",
    city: "Cotonou",
    zones: ["Marché Dantokpa", "St Michel", "Haie Vive", "Fidjrossè", "Akpakpa"],
    vehicleType: "ZEM",
    vehicleModel: "Bajaj Boxer 150 Cargo",
    plateNumber: "BJ-6712-AC",
    categoryId: "COURSIER_PERSONNEL",
    experienceYears: 4,
    agencyId: mainAgency.id,
    rating: 4.9,
    jobsCompleted: 38,
    docKinds: ["CNI", "SELFIE", "PERMIS", "PHOTO_VEHICULE"],
    sampleDocPath,
    inTwoYears,
    adminId: adminUser?.id,
  });

  // 6. Trois dossiers en attente dans la console Admin (pour démonstration de la validation KYC)
  const pendingZemUser = await upsertUserWithWallet({
    phone: "+2290196112233",
    fullName: "Gildas Agbossou",
    role: "CLIENT",
    status: "PENDING_VALIDATION",
    balance: 5000,
  });
  await upsertPendingProvider({
    user: pendingZemUser,
    type: "DRIVER",
    status: "SUBMITTED",
    fullName: "Gildas Agbossou",
    city: "Abomey-Calavi",
    zones: ["Calavi Kpota", "IITA", "Godomey", "Étoile Rouge"],
    vehicleType: "ZEM",
    vehicleModel: "TVS HLX 150",
    plateNumber: "BJ-5540-AD",
    experienceYears: 4,
    submittedAt: hoursAgo(6),
    docKinds: ["CNI", "SELFIE", "PERMIS", "CARTE_GRISE", "ASSURANCE", "PHOTO_VEHICULE"],
    sampleDocPath,
    inTwoYears,
  });

  const pendingCourierUser = await upsertUserWithWallet({
    phone: "+2290196445566",
    fullName: "Prisca Hounkpatin",
    role: "CLIENT",
    status: "PENDING_VALIDATION",
    balance: 8500,
  });
  await upsertPendingProvider({
    user: pendingCourierUser,
    type: "COURIER",
    status: "UNDER_REVIEW",
    fullName: "Prisca Hounkpatin",
    city: "Cotonou",
    zones: ["Cadjèhoun", "St Michel", "Ganhi", "Agla"],
    vehicleType: "ZEM_ELECTRIC",
    vehicleModel: "Spiro Électrique Express",
    plateNumber: "BJ-7782-AE",
    categoryId: "COURSIER_PERSONNEL",
    experienceYears: 2,
    submittedAt: hoursAgo(14),
    docKinds: ["CNI", "SELFIE", "PERMIS", "PHOTO_VEHICULE"],
    sampleDocPath,
    inTwoYears,
  });

  const pendingAgencyUser = await upsertUserWithWallet({
    phone: "+2290196778899",
    fullName: "Honoré Kpadonou",
    role: "CLIENT",
    status: "PENDING_VALIDATION",
    balance: 120000,
  });
  await upsertPendingProvider({
    user: pendingAgencyUser,
    type: "AGENCY",
    status: "SUBMITTED",
    fullName: "Honoré Kpadonou",
    city: "Porto-Novo & Cotonou",
    zones: ["Akpakpa", "Sèmè-Podji", "Porto-Novo Centre"],
    agencyName: "Bénin Express Logistique SARL",
    plan: "ARGENT",
    experienceYears: 6,
    submittedAt: hoursAgo(3),
    docKinds: ["CNI", "SELFIE", "RCCM", "IFU", "STATUTS"],
    sampleDocPath,
    inTwoYears,
  });

  // 7. Courses réalistes (terminées + en attente pour le Zém Radar)
  const existingRides = await prisma.ride.count();
  if (existingRides < 4) {
    await prisma.ride.createMany({
      data: [
        {
          clientId: client.id,
          driverId: zemDriver.id,
          status: "COMPLETED",
          vehicleType: "ZEM",
          originLat: 6.3579,
          originLng: 2.3912,
          destLat: 6.3541,
          destLng: 2.4352,
          price: 700,
          commission: 105,
          rating: 5,
          createdAt: hoursAgo(2),
        },
        {
          clientId: client.id,
          driverId: fleetDriver1.id,
          status: "COMPLETED",
          vehicleType: "ZEM_ELECTRIC",
          originLat: 6.3654,
          originLng: 2.4181,
          destLat: 6.3721,
          destLng: 2.4391,
          price: 900,
          commission: 18,
          rating: 5,
          createdAt: hoursAgo(5),
        },
        {
          clientId: client.id,
          driverId: fleetDriver2.id,
          status: "COMPLETED",
          vehicleType: "CAR",
          originLat: 6.3572,
          originLng: 2.3844,
          destLat: 6.3511,
          destLng: 2.4125,
          price: 2500,
          commission: 50,
          rating: 5,
          createdAt: daysAgo(1),
        },
        // 2 courses en attente (PENDING) visibles immédiatement dans Zém Radar
        {
          clientId: client.id,
          driverId: null,
          status: "PENDING",
          vehicleType: "ZEM",
          originLat: 6.3615,
          originLng: 2.4085,
          destLat: 6.3702,
          destLng: 2.4318,
          price: 750,
          commission: 113,
          createdAt: hoursAgo(0.1),
        },
        {
          clientId: pendingZemUser.id,
          driverId: null,
          status: "PENDING",
          vehicleType: "ZEM_ELECTRIC",
          originLat: 6.3528,
          originLng: 2.3961,
          destLat: 6.3688,
          destLng: 2.4215,
          price: 900,
          commission: 135,
          createdAt: hoursAgo(0.05),
        },
      ],
    });
  }

  // 8. Missions de livraison / Coursier réalistes (terminées + en attente sur le Radar Coursier)
  const existingDeliveries = await prisma.delivery.count();
  if (existingDeliveries < 3) {
    await prisma.delivery.createMany({
      data: [
        {
          clientId: client.id,
          courierId: courierUser.id,
          packageType: "personal",
          pickupAddress: "Pharmacie Camp Guézo, Cotonou",
          dropAddress: "Fidjrossè Calvaire, Von pavée",
          payer: "SENDER",
          price: 2000,
          pickupCode: "4821",
          deliveryCode: "9034",
          status: "COMPLETED",
          createdAt: hoursAgo(3),
        },
        // 2 missions PENDING visibles immédiatement dans l'Espace Coursier / Livreur
        {
          clientId: client.id,
          courierId: null,
          packageType: "personal",
          pickupAddress: "Supermarché Erevan, Akpakpa",
          dropAddress: "Haie Vive, près des Cocotiers",
          payer: "SENDER",
          price: 2000,
          pickupCode: "3910",
          deliveryCode: "7428",
          status: "PENDING",
          createdAt: hoursAgo(0.2),
        },
        {
          clientId: pendingAgencyUser.id,
          courierId: null,
          packageType: "doc",
          pickupAddress: "Ganhi, Immeuble BIBE, Cotonou",
          dropAddress: "Cadjèhoun, Ministère du Plan",
          payer: "SENDER",
          price: 1000,
          pickupCode: "5512",
          deliveryCode: "8841",
          status: "PENDING",
          createdAt: hoursAgo(0.1),
        },
      ],
    });
  }

  // 9. Transactions réalistes pour le client de démo
  const clientWallet = await prisma.wallet.findUnique({ where: { userId: client.id } });
  if (clientWallet) {
    const txCount = await prisma.transaction.count({ where: { walletId: clientWallet.id } });
    if (txCount === 0) {
      await prisma.transaction.createMany({
        data: [
          {
            walletId: clientWallet.id,
            type: "CREDIT",
            amount: 50000,
            label: "Recharge MTN Mobile Money",
            meta: "Réf. MOMO-BJ-982411",
            createdAt: daysAgo(2),
          },
          {
            walletId: clientWallet.id,
            type: "DEBIT",
            amount: 2500,
            label: "Course Voiture Confort — Aéroport → Novotel",
            meta: "Conducteur : Ulrich Houngbédji",
            createdAt: daysAgo(1),
          },
          {
            walletId: clientWallet.id,
            type: "DEBIT",
            amount: 2000,
            label: "Coursier Personnel — Pharmacie Camp Guézo → Fidjrossè",
            meta: "Coursier : Fifamè Arnaud Zinsou",
            createdAt: hoursAgo(3),
          },
          {
            walletId: clientWallet.id,
            type: "DEBIT",
            amount: 700,
            label: "Course Zem Express — Haie Vive → Ganhi",
            meta: "Conducteur : Romaric Soglo",
            createdAt: hoursAgo(2),
          },
        ],
      });
    }
  }

  console.log("✔ Écosystème réaliste AZƆ̀ Bénin initialisé :");
  console.log("  • Admin              : +229 01 97 00 00 00 (Direction Générale AZƆ̀ Bénin)");
  console.log("  • Client             : +229 01 97 00 00 42 (Kossi Boris Adjovi — 48 500 FCFA)");
  console.log("  • Zem indépendant    : +229 01 97 00 00 01 (Romaric Soglo — Haojue DK 150)");
  console.log("  • Coursier personnel : +229 01 97 00 00 04 (Fifamè Arnaud Zinsou — Bajaj Boxer)");
  console.log("  • Agence Or          : +229 01 97 00 00 10 (Atlantique Mobilité & Flotte Cotonou SARL)");
  console.log("  • 3 dossiers KYC complets avec pièces en attente dans la console Admin");
}

async function upsertApprovedProvider({
  user,
  type,
  fullName,
  city,
  zones,
  vehicleType = null,
  vehicleModel = null,
  plateNumber = null,
  categoryId = null,
  agencyName = null,
  plan = null,
  agencyId = null,
  experienceYears = 3,
  rating = 4.9,
  jobsCompleted = 25,
  docKinds = [],
  sampleDocPath,
  inTwoYears,
  adminId = null,
}) {
  const now = new Date();
  let profile = await prisma.providerProfile.findUnique({ where: { userId: user.id } });
  if (!profile) {
    profile = await prisma.providerProfile.create({
      data: {
        userId: user.id,
        type,
        status: "APPROVED",
        fullName,
        city,
        zones,
        vehicleType,
        vehicleModel,
        plateNumber,
        categoryId,
        agencyName,
        plan,
        agencyId,
        experienceYears,
        rating,
        jobsCompleted,
        kycScore: 100,
        submittedAt: now,
        reviewedAt: now,
        activatedAt: now,
        reviewedById: adminId,
      },
    });
    await prisma.providerEvent.create({
      data: {
        providerId: profile.id,
        actorId: adminId,
        type: "APPROVED",
        comment: "Dossier complet vérifié et approuvé par l'équipe conformité AZƆ̀ Bénin",
      },
    });
  } else {
    profile = await prisma.providerProfile.update({
      where: { id: profile.id },
      data: {
        type,
        status: "APPROVED",
        fullName,
        city,
        zones,
        vehicleType,
        vehicleModel,
        plateNumber,
        categoryId,
        agencyName,
        plan,
        agencyId,
        rating,
        jobsCompleted,
        kycScore: 100,
      },
    });
  }

  for (const kind of docKinds) {
    const existingDoc = await prisma.providerDocument.findFirst({
      where: { providerId: profile.id, kind },
    });
    if (!existingDoc) {
      await prisma.providerDocument.create({
        data: {
          providerId: profile.id,
          kind,
          url: sampleDocPath,
          mimeType: "image/png",
          sizeBytes: 18420,
          status: "VALID",
          expiresAt: ["CNI", "PERMIS", "ASSURANCE", "VISITE_TECHNIQUE"].includes(kind)
            ? inTwoYears
            : null,
          reviewedAt: now,
        },
      });
    }
  }
}

async function upsertPendingProvider({
  user,
  type,
  status,
  fullName,
  city,
  zones,
  vehicleType = null,
  vehicleModel = null,
  plateNumber = null,
  categoryId = null,
  agencyName = null,
  plan = null,
  experienceYears = 3,
  submittedAt,
  docKinds = [],
  sampleDocPath,
  inTwoYears,
}) {
  let profile = await prisma.providerProfile.findUnique({ where: { userId: user.id } });
  if (!profile) {
    profile = await prisma.providerProfile.create({
      data: {
        userId: user.id,
        type,
        status,
        fullName,
        city,
        zones,
        vehicleType,
        vehicleModel,
        plateNumber,
        categoryId,
        agencyName,
        plan,
        experienceYears,
        kycScore: 80,
        submittedAt,
      },
    });
    await prisma.providerEvent.create({
      data: {
        providerId: profile.id,
        type: "SUBMITTED",
        comment: `Dossier ${type} déposé depuis l'application mobile AZƆ̀ (${city})`,
        createdAt: submittedAt,
      },
    });
  }

  for (const kind of docKinds) {
    const existingDoc = await prisma.providerDocument.findFirst({
      where: { providerId: profile.id, kind },
    });
    if (!existingDoc) {
      await prisma.providerDocument.create({
        data: {
          providerId: profile.id,
          kind,
          url: sampleDocPath,
          mimeType: "image/png",
          sizeBytes: 24100,
          status: "PENDING",
          expiresAt: ["CNI", "PERMIS", "ASSURANCE", "VISITE_TECHNIQUE"].includes(kind)
            ? inTwoYears
            : null,
        },
      });
    }
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
    console.error("Usage : npm run providers:approve -- +2290197000042 [DRIVER|COURIER|AGENCY]");
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
      const admin = await ensureAdmin();
      await seedRealisticEcosystem(admin);
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
