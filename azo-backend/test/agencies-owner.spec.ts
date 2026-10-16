/**
 * Le propriétaire de l'agence est rattaché à son agence (User.agencyId) mais n'est ni un chauffeur ni une place
 * de la formule : il ne doit apparaître ni dans la liste, ni dans les places utilisées, et ne peut pas se retirer.
 */
jest.mock("@prisma/client", () => ({
  Role: { CLIENT: "CLIENT", DRIVER: "DRIVER", COURIER: "COURIER", AGENCY: "AGENCY", ADMIN: "ADMIN" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/notifications/notifications.module", () => ({
  NotificationsModule: class NotificationsModule {},
  NotificationsService: class NotificationsService {},
}));
jest.mock("../src/pricing/pricing.module", () => ({
  PricingModule: class PricingModule {},
  PricingService: class PricingService {},
}));
jest.mock("../src/wallet/wallet.module", () => ({
  WalletModule: class WalletModule {},
  WalletService: class WalletService {},
}));

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AgenciesService } from "../src/agencies/agencies.module";

const ownerId = "owner-1";
const agencyId = "agency-1";

function makeService() {
  const members = [
    { id: ownerId, role: "AGENCY", fullName: "Gérant", phone: "0100000000", status: "ACTIVE", agencyId },
    { id: "driver-1", role: "DRIVER", fullName: "Romaric", phone: "0100000001", status: "ACTIVE", agencyId },
    { id: "driver-2", role: "COURIER", fullName: "Koffi", phone: "0100000002", status: "ACTIVE", agencyId },
  ];
  const agency = {
    id: agencyId, name: "Flotte Cotonou", plan: "PRO", commissionRate: 0.03, maxAccounts: 25,
    activationFee: 100000, feePaidAt: new Date(), createdAt: new Date(), drivers: members,
  };
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(
          where.id === ownerId
            ? { id: ownerId, agency }
            : members.find((m) => m.id === where.id) ? { ...members.find((m) => m.id === where.id), provider: null } : null
        )
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    ride: { findMany: jest.fn().mockResolvedValue([]) },
    providerProfile: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    wallet: { findMany: jest.fn().mockResolvedValue([]) },
    providerEvent: { create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const pricing: any = {
    agencyCanOperate: jest.fn().mockReturnValue(true),
    getAgencyLevel: jest.fn().mockReturnValue({ commissionPct: 3, withdrawalFeePct: 1 }),
    canAgencyAddAccount: jest.fn().mockReturnValue(true),
    agencyMaxAccounts: jest.fn().mockReturnValue(25),
  };
  const notifications: any = { push: jest.fn().mockResolvedValue({}) };
  const service = new AgenciesService(prisma, notifications, pricing, {} as any);
  return { service, prisma, pricing };
}

describe("agence : le propriétaire n'est pas un chauffeur", () => {
  it("le tableau de bord ne compte ni ne liste le propriétaire", async () => {
    const { service } = makeService();
    const dashboard: any = await service.dashboard(ownerId);
    expect(dashboard.drivers).toBe(2);
    expect(dashboard.seatsUsed).toBe(2);
    expect(dashboard.roster.map((r: any) => r.id)).toEqual(["driver-1", "driver-2"]);
  });

  it("ne cherche les courses que des vrais chauffeurs", async () => {
    const { service, prisma } = makeService();
    await service.dashboard(ownerId);
    for (const [args] of prisma.ride.findMany.mock.calls) {
      expect(args.where.driverId.in).toEqual(["driver-1", "driver-2"]);
    }
  });

  it("le plafond de comptes ne compte pas le propriétaire", async () => {
    const { service, pricing } = makeService();
    await service.attachDriver(ownerId, "0100000003").catch(() => undefined);
    expect(pricing.canAgencyAddAccount).toHaveBeenCalledWith("PRO", 2);
  });

  it("le propriétaire ne peut pas se retirer de son agence", async () => {
    const { service, prisma } = makeService();
    await expect(service.detachDriver(ownerId, ownerId)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("un vrai chauffeur peut toujours être retiré", async () => {
    const { service, prisma } = makeService();
    await expect(service.detachDriver(ownerId, "driver-1")).resolves.toMatchObject({ detached: "driver-1" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("un compte qui n'est pas dans l'agence reste introuvable", async () => {
    const { service } = makeService();
    await expect(service.detachDriver(ownerId, "inconnu")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("agence : recharger / retirer de l'argent sur le compte d'un chauffeur", () => {
  function makeWalletService(balances: Record<string, number>, protectedBalances: Record<string, number> = {}) {
    const base = makeService();
    const originalUserFindUnique = base.prisma.user.findUnique;
    const protectedLookup = (args: any) =>
      args?.select?.agencyProtectedBalance ? Promise.resolve({ agencyProtectedBalance: protectedBalances[args.where.id] ?? 0 }) : originalUserFindUnique(args);
    base.prisma.user.findUnique = jest.fn().mockImplementation(protectedLookup);
    const wallets: Record<string, { id: string; userId: string; balance: number }> = {};
    const wallet = (userId: string) => (wallets[userId] ??= { id: "w-" + userId, userId, balance: balances[userId] ?? 0 });
    const transactions: any[] = [];
    const tx: any = {
      user: { findUnique: jest.fn().mockImplementation(protectedLookup) },
      wallet: {
        upsert: jest.fn().mockImplementation(({ where }) => Promise.resolve(wallet(where.userId))),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          const w = Object.values(wallets).find((x) => x.id === where.id)!;
          if (where.balance?.gte !== undefined && w.balance < where.balance.gte) return Promise.resolve({ count: 0 });
          w.balance -= data.balance.decrement;
          return Promise.resolve({ count: 1 });
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const w = Object.values(wallets).find((x) => x.id === where.id)!;
          w.balance += data.balance.increment;
          return Promise.resolve(w);
        }),
      },
      transaction: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(transactions.find((t) => t.walletId === where.walletId && t.meta === where.meta) ?? null)
        ),
        createMany: jest.fn().mockImplementation(({ data }) => {
          transactions.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
    };
    base.prisma.$transaction = jest.fn().mockImplementation((cb: any) => cb(tx));
    base.prisma.wallet = { findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(wallet(where.userId))) };
    return { ...base, wallets, transactions };
  }

  it("l'agence recharge un chauffeur : débit agence, crédit chauffeur, deux écritures", async () => {
    const { service, wallets, transactions } = makeWalletService({ [ownerId]: 20000 });
    const res: any = await service.fundDriver(ownerId, "driver-1", 5000);
    expect(wallets[ownerId].balance).toBe(15000);
    expect(wallets["driver-1"].balance).toBe(5000);
    expect(res).toMatchObject({ direction: "fund", amount: 5000, agencyBalance: 15000, driver: { id: "driver-1", balance: 5000 } });
    expect(transactions.map((t) => t.type)).toEqual(["DEBIT", "CREDIT"]);
    expect(transactions.every((t) => t.kind === "AGENCY_TRANSFER" && t.amount === 5000)).toBe(true);
  });

  it("recharge refusée si le solde de l'agence est insuffisant", async () => {
    const { service, wallets } = makeWalletService({ [ownerId]: 1000 });
    await expect(service.fundDriver(ownerId, "driver-1", 5000)).rejects.toBeInstanceOf(BadRequestException);
    expect(wallets[ownerId].balance).toBe(1000);
  });

  it("l'agence retire de l'argent du chauffeur vers son portefeuille", async () => {
    const { service, wallets } = makeWalletService({ "driver-1": 8000 });
    const res: any = await service.withdrawFromDriver(ownerId, "driver-1", 3000);
    expect(wallets["driver-1"].balance).toBe(5000);
    expect(wallets[ownerId].balance).toBe(3000);
    expect(res).toMatchObject({ direction: "withdraw", agencyBalance: 3000, driver: { balance: 5000 } });
  });

  it("l'argent d'avant le rattachement reste au chauffeur : l'agence ne retire que la part gagnée ou rechargée depuis", async () => {
    // 8 000 F sur le compte, dont 5 000 F que le chauffeur avait avant d'entrer dans l'agence : 3 000 F seulement sont accessibles
    const { service, wallets } = makeWalletService({ "driver-1": 8000 }, { "driver-1": 5000 });
    const ok: any = await service.withdrawFromDriver(ownerId, "driver-1", 3000);
    expect(wallets["driver-1"].balance).toBe(5000);
    expect(wallets[ownerId].balance).toBe(3000);
    expect(ok.driver.balance).toBe(0); // l'agence ne voit plus rien de disponible : le reste est le solde personnel du chauffeur
  });

  it("retrait refusé dès qu'il toucherait au solde d'avant le rattachement", async () => {
    const { service, wallets } = makeWalletService({ "driver-1": 8000 }, { "driver-1": 5000 });
    await expect(service.withdrawFromDriver(ownerId, "driver-1", 3001)).rejects.toMatchObject({ response: { code: "AGENCY_PROTECTED_BALANCE" } });
    expect(wallets["driver-1"].balance).toBe(8000);
    expect(wallets[ownerId]?.balance ?? 0).toBe(0);
  });

  it("retrait refusé au-delà du solde du chauffeur", async () => {
    const { service, wallets } = makeWalletService({ "driver-1": 2000 });
    await expect(service.withdrawFromDriver(ownerId, "driver-1", 3000)).rejects.toBeInstanceOf(BadRequestException);
    expect(wallets["driver-1"].balance).toBe(2000);
  });

  it("la même clé d'idempotence ne rejoue pas le transfert", async () => {
    const { service, wallets } = makeWalletService({ [ownerId]: 20000 });
    await service.fundDriver(ownerId, "driver-1", 5000, "clef-1");
    const again: any = await service.fundDriver(ownerId, "driver-1", 5000, "clef-1");
    expect(again.replayed).toBe(true);
    expect(wallets[ownerId].balance).toBe(15000);
    expect(wallets["driver-1"].balance).toBe(5000);
  });

  it("impossible de toucher le compte d'un chauffeur d'une autre agence ni celui du propriétaire", async () => {
    const { service } = makeWalletService({ [ownerId]: 20000 });
    await expect(service.fundDriver(ownerId, "inconnu", 1000)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.fundDriver(ownerId, ownerId, 1000)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.withdrawFromDriver(ownerId, ownerId, 1000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("agence non activée : aucun transfert", async () => {
    const { service, pricing } = makeWalletService({ [ownerId]: 20000 });
    pricing.agencyCanOperate.mockReturnValue(false);
    await expect(service.fundDriver(ownerId, "driver-1", 1000)).rejects.toBeInstanceOf(BadRequestException);
  });
});
