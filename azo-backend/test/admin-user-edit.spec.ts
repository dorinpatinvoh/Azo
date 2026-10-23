import { BadRequestException } from "@nestjs/common";

jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {}, WalletModule: class {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class {}, PricingModule: class {} }));

import { AdminService } from "../src/admin/admin.module";

function make(user: any) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockReturnValue("u") },
    providerProfile: { update: jest.fn().mockReturnValue("p") },
    userProfileChange: { create: jest.fn().mockReturnValue("c") },
    transaction: { create: jest.fn().mockReturnValue("t") },
    wallet: { update: jest.fn().mockReturnValue("w") },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { prisma, svc: new AdminService(prisma, {} as any, {} as any, {} as any) };
}

describe("admin : nom et portefeuille d'un utilisateur", () => {
  it("corrige le nom du compte et du dossier prestataire, avec une trace", async () => {
    const { svc, prisma } = make({ id: "u1", fullName: "Kosi", phone: "+2290197000001", provider: { id: "p1" } });
    const r = await svc.renameUser("a", "u1", { firstName: "  Kossi ", lastName: "Adjovi" });
    expect(r.fullName).toBe("Kossi Adjovi");
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ firstName: "Kossi", lastName: "Adjovi", fullName: "Kossi Adjovi" });
    expect(prisma.providerProfile.update).toHaveBeenCalled();
    expect(prisma.userProfileChange.create.mock.calls[0][0].data).toMatchObject({ oldValue: "Kosi", newValue: "Kossi Adjovi" });
  });

  it("remet le portefeuille à zéro avec une écriture, sauf pour un administrateur ou une agence", async () => {
    const ok = make({ id: "u1", role: "CLIENT", phone: "+2290197000001", wallet: { id: "w1", balance: 4200 } });
    expect(await ok.svc.resetWallet("a", "u1", "test")).toEqual({ userId: "u1", before: 4200, after: 0 });
    expect(ok.prisma.transaction.create.mock.calls[0][0].data).toMatchObject({ type: "DEBIT", amount: 4200, kind: "ADMIN_RESET" });
    expect(ok.prisma.wallet.update.mock.calls[0][0].data).toEqual({ balance: 0 });
    const neg = make({ id: "u2", role: "DRIVER", phone: "+2290197000002", wallet: { id: "w2", balance: -300 } });
    await neg.svc.resetWallet("a", "u2");
    expect(neg.prisma.transaction.create.mock.calls[0][0].data).toMatchObject({ type: "CREDIT", amount: 300 });
    for (const role of ["ADMIN", "AGENCY"]) {
      const x = make({ id: "u3", role, phone: "+2290197000003", wallet: { id: "w3", balance: 10 } });
      await expect(x.svc.resetWallet("a", "u3")).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
