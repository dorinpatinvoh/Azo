jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));

import { FinanceService } from "../src/admin/finance.service";

function make(total: number, paid: number, requested: number, wallets: { id: string; balance: number }[]) {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    companyWithdrawal: { create: jest.fn() },
    wallet: { findMany: jest.fn().mockResolvedValue(wallets), update: jest.fn() },
    transaction: { create: jest.fn() },
    appSetting: { upsert: jest.fn() },
  };
  const prisma: any = { $transaction: (fn: any) => fn(tx), appSetting: { findUnique: jest.fn().mockResolvedValue(null) } };
  const svc: any = new FinanceService(prisma);
  jest.spyOn(svc, "revenue").mockResolvedValue({ total });
  jest.spyOn(svc, "committed").mockResolvedValue({ requested, paid });
  return { svc, tx };
}

describe("remise à zéro des chiffres d'argent de l'entreprise", () => {
  it("pose une date de départ, remet le portefeuille admin à 0 et n'efface ni ne crée aucun retrait", async () => {
    const { svc, tx } = make(100000, 20000, 5000, [{ id: "w1", balance: 75000 }]);
    const before = Date.now();
    const r = await svc.resetToZero("a", "lancement");
    expect(r).toEqual({ before: 75000, walletsReset: 1 });
    expect(tx.companyWithdrawal.create).not.toHaveBeenCalled();
    expect(tx.transaction.create.mock.calls[0][0].data).toMatchObject({ type: "DEBIT", amount: 75000 });
    expect(tx.wallet.update.mock.calls[0][0].data).toEqual({ balance: 0 });
    const saved = tx.appSetting.upsert.mock.calls[0][0];
    expect(saved.where.key).toBe("moneyBaselineAt");
    expect(new Date(saved.update.value).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("fonctionne même quand rien n'est disponible", async () => {
    const { svc, tx } = make(10000, 10000, 0, []);
    expect(await svc.resetToZero("a")).toEqual({ before: 0, walletsReset: 0 });
    expect(tx.appSetting.upsert).toHaveBeenCalled();
  });
});
