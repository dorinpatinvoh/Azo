jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));

import { FinanceService } from "../src/admin/finance.service";

function make(total: number, paid: number, requested: number, wallets: { id: string; balance: number }[]) {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    companyWithdrawal: { create: jest.fn().mockResolvedValue({}) },
    wallet: { findMany: jest.fn().mockResolvedValue(wallets), update: jest.fn() },
    transaction: { create: jest.fn() },
  };
  const prisma: any = { $transaction: (fn: any) => fn(tx) };
  const svc: any = new FinanceService(prisma);
  jest.spyOn(svc, "revenue").mockResolvedValue({ total });
  jest.spyOn(svc, "committed").mockResolvedValue({ requested, paid });
  return { svc, tx };
}

describe("remise à zéro du portefeuille de l'entreprise", () => {
  it("solde les gains disponibles par un retrait versé et ramène le portefeuille admin à 0", async () => {
    const { svc, tx } = make(100000, 20000, 5000, [{ id: "w1", balance: 75000 }]);
    const r = await svc.resetToZero("a", "fin de mois");
    expect(r).toEqual({ before: 75000, walletsReset: 1 });
    expect(tx.companyWithdrawal.create.mock.calls[0][0].data).toMatchObject({ amount: 75000, status: "PAID", method: "RESET" });
    expect(tx.transaction.create.mock.calls[0][0].data).toMatchObject({ type: "DEBIT", amount: 75000 });
    expect(tx.wallet.update.mock.calls[0][0].data).toEqual({ balance: 0 });
  });

  it("ne crée aucun retrait quand il n'y a rien de disponible", async () => {
    const { svc, tx } = make(10000, 10000, 0, []);
    expect(await svc.resetToZero("a")).toEqual({ before: 0, walletsReset: 0 });
    expect(tx.companyWithdrawal.create).not.toHaveBeenCalled();
  });
});
