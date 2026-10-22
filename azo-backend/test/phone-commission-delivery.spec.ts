import { WalletService } from "../src/wallet/wallet.service";

describe("Commission téléphone : règlement d'une livraison (coursier ou livreur)", () => {
  function make() {
    const created: any[] = [];
    const increments: number[] = [];
    const tx: any = {
      wallet: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "wallet-x", balance: 100000 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(async ({ data }: any) => { if (data.balance?.increment) increments.push(data.balance.increment); return {}; }),
        upsert: jest.fn().mockResolvedValue({ id: "wallet-admin" }),
      },
      transaction: { create: jest.fn(async ({ data }: any) => { created.push(data); return data; }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "admin-1" }) },
    };
    const prisma: any = {
      wallet: { findUnique: jest.fn().mockResolvedValue({ id: "wallet-x" }), create: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    return { service: new WalletService(prisma, {} as any, {} as any), created, increments };
  }

  it("règle une livraison de 2 000 F avec 15 % + 10 % : le livreur reçoit 1 500 F, l'entreprise 300 F, la commission téléphone 200 F", async () => {
    const { service, created, increments } = make();
    await service.settleDelivery({ clientId: "c1", courierId: "k1", price: 2000, net: 1500, commission: 300, phoneCommission: 200, dropAddress: "Fidjrossè", ref: "d1" });
    // le livreur : gain entier, puis commission de l'entreprise et commission téléphone débitées
    expect(created.find((t) => t.labelKey === "TRANSACTION_DELIVERY_EARNING")).toMatchObject({ type: "CREDIT", amount: 2000 });
    expect(created.find((t) => t.labelKey === "TRANSACTION_PLATFORM_COMMISSION")).toMatchObject({ type: "DEBIT", amount: 300 });
    expect(created.find((t) => t.labelKey === "TRANSACTION_PHONE_COMMISSION")).toMatchObject({ type: "DEBIT", amount: 200, label: "Commission téléphone (10 %)" });
    // le portefeuille du livreur reçoit le net ; l'administrateur reçoit les deux commissions, la seconde sous son propre libellé
    expect(increments).toEqual([1500, 300, 200]);
    expect(created.filter((t) => t.type === "CREDIT").map((t) => t.label)).toContain("Commission téléphone (à reverser aux boutiques)");
  });

  it("sans commission téléphone : aucune ligne ni versement supplémentaire", async () => {
    const { service, created, increments } = make();
    await service.settleDelivery({ clientId: "c1", courierId: "k1", price: 2000, net: 1700, commission: 300, dropAddress: "Fidjrossè", ref: "d1" });
    expect(created.find((t) => t.labelKey === "TRANSACTION_PHONE_COMMISSION")).toBeUndefined();
    expect(increments).toEqual([1700, 300]);
  });
});
