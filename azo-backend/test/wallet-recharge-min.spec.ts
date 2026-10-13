/** Recharge FedaPay : montant minimum de 300 FCFA (refusé avant tout appel à FedaPay). */
jest.mock("@prisma/client", () => ({
  Prisma: {},
  TransactionStatus: { CONFIRMED: "CONFIRMED", PENDING: "PENDING", FAILED: "FAILED" },
  TransactionType: { CREDIT: "CREDIT", DEBIT: "DEBIT" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/pricing/pricing.service", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/wallet/fedapay.service", () => ({ FedaPayService: class FedaPayService {} }));

import { BadRequestException } from "@nestjs/common";
import { MIN_RECHARGE, WalletService } from "../src/wallet/wallet.service";

function makeService() {
  const fedaPay = {
    createTransaction: jest.fn().mockResolvedValue({ transaction: { id: 42 }, token: { url: "https://pay.test/42" } }),
  };
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({ email: null }) },
    wallet: { findUnique: jest.fn().mockResolvedValue({ id: "w1", userId: "u1", balance: 0 }) },
    transaction: { create: jest.fn().mockResolvedValue({}) },
  };
  return { service: new WalletService(prisma, {} as any, fedaPay as any), fedaPay, prisma };
}

describe("recharge minimale", () => {
  it("le minimum est de 300 FCFA", () => expect(MIN_RECHARGE).toBe(300));

  it.each([0, 100, 299, 299.5])("refuse %s FCFA sans appeler FedaPay", async (amount) => {
    const { service, fedaPay } = makeService();
    await expect(service.initRecharge("u1", amount)).rejects.toBeInstanceOf(BadRequestException);
    expect(fedaPay.createTransaction).not.toHaveBeenCalled();
  });

  it("accepte 300 FCFA et enregistre une recharge en attente", async () => {
    const { service, fedaPay, prisma } = makeService();
    const res: any = await service.initRecharge("u1", 300);
    expect(fedaPay.createTransaction).toHaveBeenCalledWith(300, expect.any(String), expect.any(String));
    expect(res).toMatchObject({ url: "https://pay.test/42", transactionId: 42 });
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", amount: 300, type: "CREDIT" }) })
    );
  });
});
