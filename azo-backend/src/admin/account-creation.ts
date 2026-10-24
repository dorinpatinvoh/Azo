import { BadRequestException, ConflictException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeBeninPhone } from "../common/phone";

const logger = new Logger("AccountCreation");

type VehicleKey = "ZEM_ESSENCE" | "ZEM_ELECTRIC" | "ZEM_TRICYCLE" | "GAZELLE" | "KOALA" | "LEOPARD";

type ProfileRule = {
  label: string;
  type: "DRIVER" | "COURIER";
  vehicles: VehicleKey[];
  model: string;
  categoryId?: string;
};

/** Profils professionnels que l'administrateur peut créer. Mêmes règles que l'inscription : le livreur express ne conduit pas de voiture. */
export const PROVIDER_PROFILES: Record<string, ProfileRule> = {
  "spider-essence": { label: "Speeder à essence", type: "DRIVER", vehicles: ["ZEM_ESSENCE"], model: "Moto à essence" },
  "spider-electrique": { label: "Speeder électrique", type: "DRIVER", vehicles: ["ZEM_ELECTRIC"], model: "Moto électrique" },
  "spider-tricycle": { label: "Speeder tricycle", type: "DRIVER", vehicles: ["ZEM_TRICYCLE"], model: "Tricycle" },
  voiture: { label: "Conducteur de voiture", type: "DRIVER", vehicles: ["GAZELLE", "KOALA", "LEOPARD"], model: "Voiture" },
  "coursier-personnel": {
    label: "Coursier personnel",
    type: "COURIER",
    vehicles: ["ZEM_ESSENCE", "ZEM_ELECTRIC", "ZEM_TRICYCLE", "GAZELLE", "KOALA", "LEOPARD"],
    model: "Véhicule du coursier",
    categoryId: "COURSIER_PERSONNEL",
  },
  "livreur-express": {
    label: "Livreur express",
    type: "COURIER",
    vehicles: ["ZEM_ESSENCE", "ZEM_ELECTRIC", "ZEM_TRICYCLE"],
    model: "Véhicule du livreur",
    categoryId: "COURSIER_EXPRESS",
  },
};

export type AgencyLevels = Record<string, { activationFee: number; commissionPct: number; maxAccounts: number }>;

function cleanPhone(raw: string): string {
  const phone = normalizeBeninPhone(String(raw ?? ""));
  if (!/^\+229\d{10}$/.test(phone)) throw new BadRequestException("Numéro invalide : 10 chiffres commençant par 01 attendus.");
  return phone;
}

function cleanName(raw: string | undefined, what: string): string {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new BadRequestException(`${what} : entre 2 et 80 caractères.`);
  return name;
}

function splitName(fullName: string) {
  const [firstName, ...rest] = fullName.split(" ");
  return { firstName, lastName: rest.join(" ") || null };
}

/**
 * Crée un compte Speeder, voiture, coursier personnel ou livreur express, déjà APPROUVÉ (l'administrateur répond de ses vérifications).
 * Un numéro qui est déjà un compte client le devient pour de bon (même compte, rien n'est dupliqué) ; un numéro qui a déjà un dossier
 * prestataire, une agence ou un administrateur est refusé : on ne modifie jamais un compte professionnel existant par cette voie.
 * Le portefeuille démarre à 0 F. L'action est tracée au journal du dossier.
 */
export async function createProviderAccount(
  prisma: PrismaService,
  adminId: string,
  dto: { phone: string; fullName: string; profile: string; vehicle?: string; plate?: string }
) {
  const rule = PROVIDER_PROFILES[dto.profile];
  if (!rule) throw new BadRequestException(`Profil inconnu. Choix : ${Object.keys(PROVIDER_PROFILES).join(", ")}.`);
  const phone = cleanPhone(dto.phone);
  const fullName = cleanName(dto.fullName, "Le nom");
  const vehicle = (dto.vehicle ? dto.vehicle.toUpperCase() : rule.vehicles[0]) as VehicleKey;
  if (!rule.vehicles.includes(vehicle)) throw new BadRequestException(`Véhicule non autorisé pour ce profil. Choix : ${rule.vehicles.join(", ")}.`);
  const plate = dto.plate?.trim().slice(0, 20) || null;

  const existing = await prisma.user.findUnique({ where: { phone }, include: { provider: { select: { id: true } } } });
  if (existing?.provider) throw new ConflictException("Ce numéro a déjà un dossier prestataire (Speeder, coursier, livreur ou agence).");
  if (existing && existing.role !== "CLIENT" && existing.role !== "DRIVER") {
    throw new ConflictException(`Ce numéro appartient déjà à un compte ${existing.role === "ADMIN" ? "administrateur" : "agence"}.`);
  }
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const names = splitName(fullName);
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { role: "DRIVER", status: "ACTIVE", ...(existing.fullName ? {} : { fullName, ...names }) },
        })
      : await tx.user.create({ data: { phone, fullName, ...names, role: "DRIVER", status: "ACTIVE" } });
    await tx.wallet.upsert({ where: { userId: user.id }, create: { userId: user.id, balance: 0, cashback: 0 }, update: {} });
    const provider = await tx.providerProfile.create({
      data: {
        userId: user.id,
        type: rule.type,
        status: "APPROVED",
        fullName: existing?.fullName || fullName,
        city: "Cotonou",
        vehicleType: vehicle,
        vehicleModel: rule.model,
        plateNumber: plate,
        ...(rule.categoryId ? { categoryId: rule.categoryId } : {}),
        activatedAt: now,
        reviewedAt: now,
        reviewedById: adminId,
      },
    });
    await tx.providerEvent.create({ data: { providerId: provider.id, actorId: adminId, type: "CREATED", comment: `Compte ${rule.label} créé par l'administrateur` } });
    await tx.providerEvent.create({ data: { providerId: provider.id, actorId: adminId, type: "APPROVED", comment: "Approuvé à la création par l'administrateur" } });
    return { user, providerId: provider.id };
  });
  logger.warn(`Compte ${rule.label} ${result.user.id} créé par l'administrateur ${adminId}${existing ? " (client existant converti)" : ""}`);
  return { userId: result.user.id, providerId: result.providerId, phone, fullName: result.user.fullName ?? fullName, profile: rule.label, vehicle, convertedFromClient: !!existing };
}

/**
 * Crée une agence et son gérant (rôle AGENCY). Le niveau fixe les frais d'activation, la commission et le plafond de comptes (tarification.json).
 * `activated` : les frais ont été encaissés hors de l'application ; sinon le gérant les paie lui-même depuis son portefeuille.
 */
export async function createAgencyAccount(
  prisma: PrismaService,
  adminId: string,
  levels: AgencyLevels,
  dto: { phone: string; ownerName: string; agencyName: string; plan: string; activated?: boolean }
) {
  const plan = String(dto.plan ?? "").toUpperCase();
  const level = levels[plan];
  if (!level) throw new BadRequestException(`Niveau inconnu. Choix : ${Object.keys(levels).join(", ")}.`);
  const phone = cleanPhone(dto.phone);
  const ownerName = cleanName(dto.ownerName, "Le nom du gérant");
  const agencyName = cleanName(dto.agencyName, "Le nom de l'agence");

  const existing = await prisma.user.findUnique({ where: { phone }, include: { provider: { select: { id: true } } } });
  if (existing?.provider || existing?.agencyId) throw new ConflictException("Ce numéro a déjà un dossier prestataire ou une agence.");
  if (existing && existing.role !== "CLIENT") throw new ConflictException(`Ce numéro appartient déjà à un compte ${existing.role === "ADMIN" ? "administrateur" : "professionnel"}.`);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const agency = await tx.agency.create({
      data: {
        name: agencyName,
        plan: plan as any,
        commissionRate: level.commissionPct / 100,
        maxAccounts: level.maxAccounts,
        activationFee: level.activationFee,
        ...(dto.activated ? { feePaidAt: now } : {}),
      },
    });
    const names = splitName(ownerName);
    const owner = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { role: "AGENCY", status: "ACTIVE", agencyId: agency.id, ...(existing.fullName ? {} : { fullName: ownerName, ...names }) } })
      : await tx.user.create({ data: { phone, fullName: ownerName, ...names, role: "AGENCY", status: "ACTIVE", agencyId: agency.id } });
    await tx.wallet.upsert({ where: { userId: owner.id }, create: { userId: owner.id, balance: 0, cashback: 0 }, update: {} });
    const provider = await tx.providerProfile.create({
      data: {
        userId: owner.id,
        type: "AGENCY",
        status: "APPROVED",
        fullName: existing?.fullName || ownerName,
        city: "Cotonou",
        agencyName,
        plan: plan as any,
        agencyId: agency.id,
        activatedAt: now,
        reviewedAt: now,
        reviewedById: adminId,
      },
    });
    await tx.providerEvent.create({ data: { providerId: provider.id, actorId: adminId, type: "CREATED", comment: `Agence « ${agencyName} » (niveau ${plan}) créée par l'administrateur` } });
    await tx.providerEvent.create({ data: { providerId: provider.id, actorId: adminId, type: "APPROVED", comment: "Approuvée à la création par l'administrateur" } });
    return { agencyId: agency.id, ownerId: owner.id };
  });
  logger.warn(`Agence ${result.agencyId} (${plan}) créée par l'administrateur ${adminId}`);
  return {
    agencyId: result.agencyId,
    ownerId: result.ownerId,
    phone,
    agencyName,
    plan,
    activationFee: level.activationFee,
    activated: !!dto.activated,
    convertedFromClient: !!existing,
  };
}
