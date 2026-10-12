import { WalletService } from "../src/wallet/wallet.service";

function makeWalletService(options: {
  balance?: number;
  existingSettlement?: { amount: number } | null;
}) {
  const tx = {
    transaction: {
      findFirst: jest.fn().mockResolvedValue(options.existingSettlement ?? null),
      create: jest.fn().mockResolvedValue({}),
    },
    wallet: {
      updateMany: jest.fn().mockResolvedValue({
        count: options.balance !== undefined && options.balance < 150 ? 0 : 1,
      }),
    },
  };
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: "zem-1", wallet: { id: "wallet-1", balance: options.balance ?? 1000 } },
      ]),
    },
    transaction: {
      findMany: jest.fn().mockResolvedValue([{ walletId: "wallet-1", amount: 1000 }]),
    },
    $transaction: jest.fn((callback) => callback(tx)),
  };
  const pricing = {
    monthlyRevenueShare: jest.fn((_profile: string, revenue: number) => Math.round(revenue * 0.15)),
  };
  const service = new WalletService(prisma as any, pricing as any, {} as any);

  return { service, prisma, pricing, tx };
}

describe("WalletService monthly Zem settlement", () => {
  it("charges 15% of credited ride earnings and records the period", async () => {
    const { service, prisma, tx } = makeWalletService({ balance: 1000 });

    const result = await service.chargeMonthlyIndependentZem("2026-09");

    expect(result).toMatchObject({
      period: "2026-09",
      charged: 150,
      outstanding: 0,
      results: [{ userId: "zem-1", revenue: 1000, amountDue: 150, status: "charged" }],
    });
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2026-09-01T00:00:00.000Z"),
            lt: new Date("2026-10-01T00:00:00.000Z"),
          },
        }),
      })
    );
    expect(tx.wallet.updateMany).toHaveBeenCalledWith({
      where: { id: "wallet-1", balance: { gte: 150 } },
      data: { balance: { decrement: 150 } },
    });
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: "wallet-1",
        amount: 150,
        meta: "zem-monthly:2026-09",
      }),
    });
  });

  it("reports the full amount due without debiting an insufficient balance", async () => {
    const { service, tx } = makeWalletService({ balance: 100 });

    const result = await service.chargeMonthlyIndependentZem("2026-09");

    expect(result).toMatchObject({
      charged: 0,
      outstanding: 150,
      results: [{ status: "insufficient_balance", amountDue: 150 }],
    });
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("does not charge a period that was already settled", async () => {
    const { service, tx } = makeWalletService({
      balance: 850,
      existingSettlement: { amount: 150 },
    });

    const result = await service.chargeMonthlyIndependentZem("2026-09");

    expect(result).toMatchObject({
      charged: 0,
      outstanding: 0,
      results: [{ status: "already_charged", amountDue: 150 }],
    });
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
  });

  it("rejects periods that are not valid YYYY-MM values", async () => {
    const { service, prisma } = makeWalletService({});

    await expect(service.chargeMonthlyIndependentZem("2026-13")).rejects.toThrow(
      "La période doit respecter le format AAAA-MM."
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
