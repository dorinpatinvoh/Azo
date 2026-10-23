jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {}, WalletModule: class {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class {}, PricingModule: class {} }));

import { AdminService } from "../src/admin/admin.module";

function make(baseline: string | null) {
  const count = jest.fn().mockResolvedValue(0);
  const prisma: any = {
    appSetting: { findUnique: jest.fn().mockResolvedValue(baseline ? { key: "moneyBaselineAt", value: baseline } : null) },
    user: { count },
    ride: { count, findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } }) },
    delivery: { count, findMany: jest.fn().mockResolvedValue([]) },
    agency: { count },
    providerProfile: { count },
    transaction: { aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: { amount: null } }) },
  };
  return { prisma, svc: new AdminService(prisma, {} as any, {} as any, {} as any) };
}

describe("tableau de bord : remise à zéro par date de départ", () => {
  it("calcule les statistiques sans date de départ", async () => {
    const { svc, prisma } = make(null);
    const r = await svc.stats();
    expect(r.users).toBe(0);
    expect(r.week).toHaveLength(7);
    expect(prisma.ride.count.mock.calls[0][0].where.createdAt.gte.getTime()).toBe(0);
  });

  it("ne compte que ce qui suit la date de départ (comptes, courses, livraisons, argent, note)", async () => {
    const at = "2026-10-24T10:00:00.000Z";
    const { svc, prisma } = make(at);
    await svc.stats();
    const gte = (c: any) => c.createdAt.gte.toISOString();
    expect(gte(prisma.user.count.mock.calls[0][0].where)).toBe(at);
    expect(gte(prisma.ride.count.mock.calls[0][0].where)).toBe(at);
    expect(gte(prisma.delivery.count.mock.calls[0][0].where)).toBe(at);
    expect(gte(prisma.ride.findMany.mock.calls[0][0].where)).toBe(at);
    expect(gte(prisma.ride.aggregate.mock.calls[0][0].where)).toBe(at);
    expect(gte(prisma.transaction.aggregate.mock.calls[0][0].where)).toBe(at);
  });
});
