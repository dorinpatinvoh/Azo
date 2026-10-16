import { BadRequestException, NotFoundException } from "@nestjs/common";

jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));

import { FinanceService, MIN_COMPANY_WITHDRAWAL } from "../src/admin/finance.service";

const thisMonth = new Date();
const lastMonth = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 15));

/** Ordre des requêtes de gains : courses, livraisons, activations d'agences, frais de retrait, part mensuelle des Spider. */
function makeService(opts: {
  rides?: { m: Date; total: number }[];
  deliveries?: { m: Date; total: number }[];
  activations?: { m: Date; total: number }[];
  fees?: { m: Date; total: number }[];
  spider?: { m: Date; total: number }[];
  requested?: number;
  paid?: number;
  withdrawal?: any;
}) {
  const queryRaw = jest
    .fn()
    .mockResolvedValueOnce(opts.rides ?? [])
    .mockResolvedValueOnce(opts.deliveries ?? [])
    .mockResolvedValueOnce(opts.activations ?? [])
    .mockResolvedValueOnce(opts.fees ?? [])
    .mockResolvedValueOnce(opts.spider ?? []);
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    companyWithdrawal: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: "w1", status: "REQUESTED", ...data })) },
  };
  const prisma: any = {
    $queryRaw: queryRaw,
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    companyWithdrawal: {
      groupBy: jest.fn().mockResolvedValue([
        { status: "REQUESTED", _sum: { amount: opts.requested ?? 0 } },
        { status: "PAID", _sum: { amount: opts.paid ?? 0 } },
      ]),
      findUnique: jest.fn().mockResolvedValue(opts.withdrawal ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { service: new FinanceService(prisma), prisma, tx };
}

describe("FinanceService : gains de l'entreprise et retraits", () => {
  it("additionne les cinq sources de gains, le mois en cours et les six derniers mois", async () => {
    const { service } = makeService({
      rides: [{ m: thisMonth, total: 4000 }, { m: lastMonth, total: 1000 }],
      deliveries: [{ m: thisMonth, total: 300 }],
      activations: [{ m: lastMonth, total: 100000 }],
      fees: [{ m: thisMonth, total: 500 }],
      spider: [{ m: thisMonth, total: 150 }],
    });
    const summary = await service.summary();
    expect(summary.total).toBe(4000 + 1000 + 300 + 100000 + 500 + 150);
    expect(summary.thisMonth).toBe(4000 + 300 + 500 + 150);
    expect(summary.sources.map((s) => s.key)).toEqual([
      "RIDE_COMMISSIONS",
      "DELIVERY_COMMISSIONS",
      "AGENCY_ACTIVATIONS",
      "WITHDRAWAL_FEES",
      "SPIDER_MONTHLY_SHARE",
    ]);
    expect(summary.months).toHaveLength(6);
    expect(summary.months[5].total).toBe(4950);
    expect(summary.available).toBe(summary.total);
  });

  it("le disponible retire les retraits demandés et versés (pas les annulés)", async () => {
    const { service } = makeService({ rides: [{ m: thisMonth, total: 10000 }], requested: 2000, paid: 3000 });
    const summary = await service.summary();
    expect(summary.withdrawn).toBe(5000);
    expect(summary.available).toBe(5000);
    expect(summary.pendingWithdrawals).toBe(2000);
  });

  it("refuse un retrait au-delà du montant disponible", async () => {
    const { service, tx } = makeService({ rides: [{ m: thisMonth, total: 5000 }], paid: 1000 });
    await expect(service.requestWithdrawal("admin-1", { amount: 4500, phone: "0197000000" })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.companyWithdrawal.create).not.toHaveBeenCalled();
  });

  it("refuse un retrait sous le minimum et un numéro invalide", async () => {
    const { service } = makeService({ rides: [{ m: thisMonth, total: 50000 }] });
    await expect(service.requestWithdrawal("admin-1", { amount: MIN_COMPANY_WITHDRAWAL - 1, phone: "0197000000" })).rejects.toBeInstanceOf(BadRequestException);
    const second = makeService({ rides: [{ m: thisMonth, total: 50000 }] });
    await expect(second.service.requestWithdrawal("admin-1", { amount: 5000, phone: "12" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enregistre un retrait valide avec le numéro normalisé", async () => {
    const { service, tx } = makeService({ rides: [{ m: thisMonth, total: 50000 }] });
    const created = await service.requestWithdrawal("admin-1", { amount: 20000, phone: "01 97 00 00 00", method: "MTN", note: " Avance " });
    expect(tx.companyWithdrawal.create).toHaveBeenCalledWith({
      data: { amount: 20000, phone: "+2290197000000", method: "MTN", note: "Avance", requestedById: "admin-1" },
    });
    expect(created).toMatchObject({ status: "REQUESTED", amount: 20000 });
  });

  it("ne marque comme versé que les retraits en attente", async () => {
    const { service, prisma } = makeService({ withdrawal: { id: "w1", status: "PAID" } });
    await expect(service.markPaid("admin-1", "w1", "REF")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.companyWithdrawal.updateMany).not.toHaveBeenCalled();
    const missing = makeService({});
    await expect(missing.service.markPaid("admin-1", "x", "REF")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("marque un retrait en attente comme versé, avec la référence et l'administrateur", async () => {
    const { service, prisma } = makeService({ withdrawal: { id: "w1", status: "REQUESTED" } });
    await service.markPaid("admin-2", "w1", " MOMO-123 ");
    expect(prisma.companyWithdrawal.updateMany).toHaveBeenCalledWith({
      where: { id: "w1", status: "REQUESTED" },
      data: expect.objectContaining({ status: "PAID", decidedById: "admin-2", reference: "MOMO-123" }),
    });
  });

  it("annule un retrait en attente", async () => {
    const { service, prisma } = makeService({ withdrawal: { id: "w1", status: "REQUESTED" } });
    await service.cancel("admin-2", "w1");
    expect(prisma.companyWithdrawal.updateMany).toHaveBeenCalledWith({
      where: { id: "w1", status: "REQUESTED" },
      data: { status: "CANCELLED", decidedById: "admin-2" },
    });
  });
});

describe("commission de chaque course (admin)", () => {
  it("donne, pour chaque course et livraison, le montant, le pourcentage et la commission, les plus récentes d'abord", async () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 16, h));
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ id: "abcdef123", at: at(10), amount: 1000, commission: 150, who: "Koffi", vehicle: "ZEM_ESSENCE" }])
      .mockResolvedValueOnce([{ id: "zzzzzz999", at: at(12), amount: 2000, who: "Awa", mode: "PERSONAL" }]);
    const service = new FinanceService({ $queryRaw: queryRaw } as any, { platformCommission: (n: number) => Math.round(n * 0.15) } as any);
    const rows = await service.commissions(10);
    expect(rows.map((r) => r.id)).toEqual(["zzzzzz999", "abcdef123"]);
    expect(rows[0]).toEqual(expect.objectContaining({ kind: "PERSONAL", amount: 2000, commission: 300, pct: 15 }));
    expect(rows[1]).toEqual(expect.objectContaining({ kind: "RIDE", ref: "Course #abcdef", amount: 1000, commission: 150, pct: 15 }));
  });

  it("n'invente pas de pourcentage pour une course sans commission (employé d'agence au taux 0)", async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([{ id: "r1xxxxxxx", at: new Date(), amount: 800, commission: 0, who: null, vehicle: null }]).mockResolvedValueOnce([]);
    const rows = await new FinanceService({ $queryRaw: queryRaw } as any).commissions();
    expect(rows[0]).toEqual(expect.objectContaining({ commission: 0, pct: 0 }));
  });
});
