/** Recharge FedaPay : le solde se met à jour tout seul (contrôle auprès de FedaPay), sans double crédit avec le webhook. */
jest.mock("@prisma/client", () => ({
  Prisma: {},
  TransactionStatus: { CONFIRMED: "CONFIRMED", PENDING: "PENDING", FAILED: "FAILED" },
  TransactionType: { CREDIT: "CREDIT", DEBIT: "DEBIT" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/pricing/pricing.service", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/wallet/fedapay.service", () => ({ FedaPayService: class FedaPayService {} }));

import { WalletService } from "../src/wallet/wallet.service";

const NOW = Date.now();

type Tx = { id: string; walletId: string; amount: number; status: string; meta: string; type: string; createdAt: Date };

function make(txs: Tx[], remoteStatus: Record<number, string | Error>) {
  const wallet = { id: "w1", userId: "u1", balance: 0 };
  const prisma: any = {
    wallet: { findUnique: jest.fn().mockResolvedValue(wallet), update: jest.fn() },
    transaction: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(txs.filter((t) => t.status === "PENDING"))),
      findFirst: jest.fn().mockImplementation(({ where }) => Promise.resolve(txs.find((t) => t.meta === where.meta && t.status === "PENDING") ?? null)),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        const tx = txs.find((t) => t.id === where.id && (!where.status || t.status === where.status));
        if (!tx) return Promise.resolve({ count: 0 });
        Object.assign(tx, data);
        return Promise.resolve({ count: 1 });
      }),
    },
    $transaction: jest.fn().mockImplementation((cb: any) =>
      cb({
        transaction: prisma.transaction,
        wallet: {
          update: jest.fn().mockImplementation(({ data }) => {
            wallet.balance += data.balance.increment;
            return Promise.resolve(wallet);
          }),
        },
      })
    ),
  };
  const fedaPay: any = {
    verifyTransaction: jest.fn().mockImplementation((id: number) => {
      const s = remoteStatus[id];
      return s instanceof Error ? Promise.reject(s) : Promise.resolve({ status: s ?? "pending" });
    }),
  };
  return { service: new WalletService(prisma, {} as any, fedaPay), wallet, prisma, fedaPay };
}

const recharge = (id: number, amount = 500, status = "PENDING"): Tx => ({
  id: "t" + id, walletId: "w1", amount, status, meta: `fedaPayId:${id}`, type: "CREDIT", createdAt: new Date(NOW - 60_000),
});

describe("contrôle automatique des recharges en attente", () => {
  it("crédite une recharge approuvée chez FedaPay, même sans webhook", async () => {
    const txs = [recharge(101)];
    const { service, wallet } = make(txs, { 101: "approved" });
    expect(await service.reconcilePendingRecharges("u1", NOW)).toBe(1);
    expect(wallet.balance).toBe(500);
    expect(txs[0].status).toBe("CONFIRMED");
  });

  it("recharge encore en attente chez FedaPay : rien ne change", async () => {
    const txs = [recharge(102)];
    const { service, wallet } = make(txs, { 102: "pending" });
    expect(await service.reconcilePendingRecharges("u1", NOW)).toBe(0);
    expect(wallet.balance).toBe(0);
    expect(txs[0].status).toBe("PENDING");
  });

  it("refusée, annulée ou expirée : passée en FAILED, sans crédit", async () => {
    const txs = [recharge(103), recharge(104), recharge(105)];
    const { service, wallet } = make(txs, { 103: "declined", 104: "canceled", 105: "expired" });
    await service.reconcilePendingRecharges("u1", NOW);
    expect(txs.map((t) => t.status)).toEqual(["FAILED", "FAILED", "FAILED"]);
    expect(wallet.balance).toBe(0);
  });

  it("plusieurs recharges : seules les approuvées sont créditées", async () => {
    const txs = [recharge(106, 300), recharge(107, 500), recharge(108, 1000)];
    const { service, wallet } = make(txs, { 106: "approved", 107: "pending", 108: "approved" });
    expect(await service.reconcilePendingRecharges("u1", NOW)).toBe(2);
    expect(wallet.balance).toBe(1300);
  });

  it("FedaPay injoignable : aucune erreur, on réessaiera", async () => {
    const txs = [recharge(109)];
    const { service, wallet } = make(txs, { 109: new Error("réseau") });
    await expect(service.reconcilePendingRecharges("u1", NOW)).resolves.toBe(0);
    expect(wallet.balance).toBe(0);
    expect(txs[0].status).toBe("PENDING");
  });

  it("un seul contrôle toutes les 1,5 secondes par utilisateur", async () => {
    const { service, fedaPay } = make([recharge(110)], { 110: "pending" });
    await service.reconcilePendingRecharges("u1", NOW);
    await service.reconcilePendingRecharges("u1", NOW + 1_000);
    expect(fedaPay.verifyTransaction).toHaveBeenCalledTimes(1);
    await service.reconcilePendingRecharges("u1", NOW + 2_000);
    expect(fedaPay.verifyTransaction).toHaveBeenCalledTimes(2);
  });

  it("ne regarde que les recharges FedaPay des 48 dernières heures", async () => {
    const { service, prisma } = make([], {});
    await service.reconcilePendingRecharges("u1", NOW);
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ walletId: "w1", status: "PENDING", meta: { startsWith: "fedaPayId:" } });
    expect(where.createdAt.gte.getTime()).toBe(NOW - 48 * 3600 * 1000);
  });
});

describe("jamais de double crédit", () => {
  it("webhook puis contrôle automatique pour la même recharge : crédit unique", async () => {
    const txs = [recharge(201, 700)];
    const { service, wallet } = make(txs, { 201: "approved" });
    const first = await service.handleFedaPayCallback(201);
    const second = await service.handleFedaPayCallback(201);
    await service.reconcilePendingRecharges("u1", NOW);
    expect(first).toMatchObject({ credited: true, amount: 700 });
    expect(second).toMatchObject({ credited: false });
    expect(wallet.balance).toBe(700);
  });

  it("deux confirmations simultanées : une seule crédite (écriture conditionnelle sur le statut)", async () => {
    const txs = [recharge(202, 400)];
    const { service, wallet } = make(txs, { 202: "approved" });
    const [a, b] = await Promise.all([service.handleFedaPayCallback(202), service.handleFedaPayCallback(202)]);
    expect([a.credited, b.credited].filter(Boolean)).toHaveLength(1);
    expect(wallet.balance).toBe(400);
  });
});
