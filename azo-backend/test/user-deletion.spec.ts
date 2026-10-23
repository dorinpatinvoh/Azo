/**
 * Suppression d'un utilisateur par l'administrateur (client, commercial, prestataire, agence, administrateur).
 * Base simulée : aucun vrai compte n'est touché.
 */
import { BadRequestException } from "@nestjs/common";
import { deleteClientAccount } from "../src/admin/client-deletion";

type U = Record<string, unknown>;

function fakePrisma(user: U, opts: { otherAdmins?: number; history?: number } = {}) {
  const ops: string[] = [];
  const op = (name: string) => jest.fn((..._a: unknown[]) => { ops.push(name); return Promise.resolve({}); });
  const h = opts.history ?? 0;
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      count: jest.fn().mockResolvedValue(opts.otherAdmins ?? 1),
      update: op("user.update"),
      updateMany: op("user.updateMany"),
      delete: op("user.delete"),
    },
    ride: { count: jest.fn().mockResolvedValueOnce(0).mockResolvedValue(h) },
    delivery: { count: jest.fn().mockResolvedValueOnce(0).mockResolvedValue(0) },
    rentalBooking: { count: jest.fn().mockResolvedValue(0) },
    marketplaceOrder: { count: jest.fn().mockResolvedValue(0) },
    artisanRequest: { count: jest.fn().mockResolvedValue(0) },
    rideTip: { count: jest.fn().mockResolvedValue(0) },
    rideOffer: { count: jest.fn().mockResolvedValue(0) },
    transaction: { count: jest.fn().mockResolvedValue(0), deleteMany: op("transaction.deleteMany") },
    wallet: { update: op("wallet.update"), delete: op("wallet.delete") },
    referrer: { delete: op("referrer.delete") },
    providerDocument: { deleteMany: op("providerDocument.deleteMany") },
    providerProfile: { update: op("providerProfile.update") },
    userAvatar: { deleteMany: op("x") }, devicePushToken: { deleteMany: op("x") }, notification: { deleteMany: op("x") },
    savedPlace: { deleteMany: op("x") }, npiRegistrationAttempt: { deleteMany: op("x") }, phoneChangeRequest: { deleteMany: op("x") },
    identityCorrectionRequest: { deleteMany: op("x") }, userProfileChange: { deleteMany: op("x") }, otpCode: { deleteMany: op("x") },
    $transaction: jest.fn((l: unknown[]) => Promise.all(l)),
  };
  return { prisma, ops };
}

const base = { id: "u1", phone: "+22997000000", role: "CLIENT", provider: null, referrerProfile: null, wallet: null };

describe("suppression d'un utilisateur par l'administrateur", () => {
  it("refuse de supprimer son propre compte", async () => {
    const { prisma } = fakePrisma(base);
    await expect(deleteClientAccount(prisma, "u1", "u1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuse de supprimer le dernier administrateur actif", async () => {
    const { prisma, ops } = fakePrisma({ ...base, role: "ADMIN" }, { otherAdmins: 0 });
    await expect(deleteClientAccount(prisma, "a", "u1")).rejects.toThrow(/dernier administrateur/);
    expect(ops).not.toContain("user.delete");
  });

  it("supprime un administrateur quand il en reste un autre", async () => {
    const { prisma, ops } = fakePrisma({ ...base, role: "ADMIN" }, { otherAdmins: 1 });
    const r = await deleteClientAccount(prisma, "a", "u1");
    expect(r.mode).toBe("deleted");
    expect(ops).toContain("user.delete");
  });

  it("supprime un prestataire sans historique (le dossier part avec le compte)", async () => {
    const { prisma, ops } = fakePrisma({ ...base, role: "DRIVER", provider: { id: "p1" } });
    expect((await deleteClientAccount(prisma, "a", "u1")).mode).toBe("deleted");
    expect(ops).toContain("user.delete");
  });

  it("anonymise un prestataire qui a un historique : dossier vidé, pièces supprimées, droits retirés", async () => {
    const { prisma, ops } = fakePrisma({ ...base, role: "DRIVER", provider: { id: "p1" } }, { history: 3 });
    expect((await deleteClientAccount(prisma, "a", "u1")).mode).toBe("anonymized");
    expect(ops).toEqual(expect.arrayContaining(["providerDocument.deleteMany", "providerProfile.update", "user.update"]));
    expect(ops).not.toContain("user.delete");
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ role: "CLIENT", status: "BLOCKED", agencyId: null });
  });

  it("supprime un commercial : filleuls détachés puis profil de parrain effacé", async () => {
    const { prisma, ops } = fakePrisma({ ...base, referrerProfile: { id: "r1", _count: { referrals: 2 } } });
    const r = await deleteClientAccount(prisma, "a", "u1");
    expect(r.detachedReferrals).toBe(2);
    expect(ops.indexOf("referrer.delete")).toBeLessThan(ops.indexOf("user.delete"));
  });
});
