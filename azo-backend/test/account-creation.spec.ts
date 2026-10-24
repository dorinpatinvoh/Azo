import { BadRequestException, ConflictException } from "@nestjs/common";

jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));

import { createAgencyAccount, createProviderAccount } from "../src/admin/account-creation";

const LEVELS = { PRO: { activationFee: 100000, commissionPct: 3, maxAccounts: 30 }, SILVER: { activationFee: 215500, commissionPct: 2.5, maxAccounts: 75 } };

function make(existing: any = null) {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "u-new", ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: existing?.id ?? "u-x", fullName: existing?.fullName ?? null, ...data })),
    },
    wallet: { upsert: jest.fn().mockResolvedValue({}) },
    providerProfile: { create: jest.fn().mockResolvedValue({ id: "p1" }) },
    providerEvent: { create: jest.fn().mockResolvedValue({}) },
    agency: { create: jest.fn().mockResolvedValue({ id: "a1" }) },
  };
  prisma.$transaction = (fn: any) => fn(prisma);
  return prisma;
}

describe("création d'un compte professionnel par l'administrateur", () => {
  it("crée un Speeder électrique approuvé, portefeuille à 0, avec deux traces au journal", async () => {
    const prisma = make();
    const r = await createProviderAccount(prisma, "adm", { phone: "01 61 42 36 02", fullName: "  Kossi   Adjovi ", profile: "spider-electrique" });
    expect(r).toMatchObject({ phone: "+2290161423602", fullName: "Kossi Adjovi", vehicle: "ZEM_ELECTRIC", convertedFromClient: false });
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ role: "DRIVER", status: "ACTIVE", firstName: "Kossi", lastName: "Adjovi" });
    expect(prisma.wallet.upsert.mock.calls[0][0].create).toMatchObject({ balance: 0 });
    expect(prisma.providerProfile.create.mock.calls[0][0].data).toMatchObject({ type: "DRIVER", status: "APPROVED", vehicleType: "ZEM_ELECTRIC", reviewedById: "adm" });
    expect(prisma.providerEvent.create).toHaveBeenCalledTimes(2);
  });

  it("un coursier personnel ou un livreur express reçoit sa catégorie ; le livreur express n'a pas de voiture", async () => {
    const a = make();
    await createProviderAccount(a, "adm", { phone: "0197000001", fullName: "Ama Dossou", profile: "livreur-express", vehicle: "ZEM_TRICYCLE" });
    expect(a.providerProfile.create.mock.calls[0][0].data).toMatchObject({ type: "COURIER", categoryId: "COURSIER_EXPRESS", vehicleType: "ZEM_TRICYCLE" });
    await expect(createProviderAccount(make(), "adm", { phone: "0197000001", fullName: "Ama Dossou", profile: "livreur-express", vehicle: "KOALA" })).rejects.toBeInstanceOf(BadRequestException);
    const c = make();
    await createProviderAccount(c, "adm", { phone: "0197000002", fullName: "Ama Dossou", profile: "coursier-personnel", vehicle: "KOALA" });
    expect(c.providerProfile.create.mock.calls[0][0].data).toMatchObject({ categoryId: "COURSIER_PERSONNEL", vehicleType: "KOALA" });
  });

  it("refuse un numéro invalide, un nom trop court, un profil inconnu", async () => {
    for (const bad of [{ phone: "123" }, { fullName: "A" }, { profile: "pirate" }]) {
      await expect(createProviderAccount(make(), "adm", { phone: "0197000003", fullName: "Ama Dossou", profile: "spider-essence", ...bad })).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("convertit un client existant sans toucher à son identité, mais refuse un compte déjà professionnel, agence ou administrateur", async () => {
    const client = make({ id: "u1", role: "CLIENT", fullName: "Déjà Client", provider: null });
    const r = await createProviderAccount(client, "adm", { phone: "0197000004", fullName: "Autre Nom", profile: "spider-essence" });
    expect(r.convertedFromClient).toBe(true);
    expect(client.user.update.mock.calls[0][0].data).toMatchObject({ role: "DRIVER" });
    expect(client.user.update.mock.calls[0][0].data.fullName).toBeUndefined();
    expect(client.providerProfile.create.mock.calls[0][0].data.fullName).toBe("Déjà Client");
    await expect(createProviderAccount(make({ id: "u2", role: "DRIVER", provider: { id: "p9" } }), "adm", { phone: "0197000005", fullName: "Ama Dossou", profile: "spider-essence" })).rejects.toBeInstanceOf(ConflictException);
    await expect(createProviderAccount(make({ id: "u3", role: "ADMIN", provider: null }), "adm", { phone: "0197000006", fullName: "Ama Dossou", profile: "spider-essence" })).rejects.toBeInstanceOf(ConflictException);
  });

  it("crée une agence au niveau choisi (frais, commission, plafond), activée seulement si les frais sont encaissés", async () => {
    const a = make();
    const r = await createAgencyAccount(a, "adm", LEVELS, { phone: "0197000010", ownerName: "Gérant Test", agencyName: "Flotte du Patron", plan: "silver", activated: true });
    expect(r).toMatchObject({ plan: "SILVER", activationFee: 215500, activated: true });
    const data = a.agency.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "Flotte du Patron", plan: "SILVER", commissionRate: 0.025, maxAccounts: 75, activationFee: 215500 });
    expect(data.feePaidAt).toBeInstanceOf(Date);
    expect(a.user.create.mock.calls[0][0].data).toMatchObject({ role: "AGENCY", agencyId: "a1" });
    expect(a.providerProfile.create.mock.calls[0][0].data).toMatchObject({ type: "AGENCY", status: "APPROVED", agencyId: "a1" });
    const b = make();
    await createAgencyAccount(b, "adm", LEVELS, { phone: "0197000011", ownerName: "Gérant Test", agencyName: "Flotte B", plan: "PRO" });
    expect(b.agency.create.mock.calls[0][0].data.feePaidAt).toBeUndefined();
    await expect(createAgencyAccount(make(), "adm", LEVELS, { phone: "0197000012", ownerName: "Gérant Test", agencyName: "X", plan: "PRO" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(createAgencyAccount(make(), "adm", LEVELS, { phone: "0197000013", ownerName: "Gérant Test", agencyName: "Flotte C", plan: "DIAMANT" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(createAgencyAccount(make({ id: "u7", role: "DRIVER", provider: null }), "adm", LEVELS, { phone: "0197000014", ownerName: "Gérant Test", agencyName: "Flotte D", plan: "PRO" })).rejects.toBeInstanceOf(ConflictException);
  });
});
