jest.mock("@prisma/client", () => ({
  Role: { CLIENT: "CLIENT", DRIVER: "DRIVER" },
  VehicleType: { ZEM_ESSENCE: "ZEM_ESSENCE", ZEM_ELECTRIC: "ZEM_ELECTRIC" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class NotificationsService {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class RidesGateway {} }));

import { PricingService } from "../src/pricing/pricing.service";
import { RidesService } from "../src/rides/rides.service";

const pricing = new PricingService();
// Téléphone remis le mardi 20 octobre 2026 : les 4 mois courent jusqu'au 20 février 2027 ; le premier week-end (exclu) est le samedi 24 et le dimanche 25
const supportedAt = new Date("2026-10-20T10:00:00Z");

describe("Commission téléphone : règles (10 %, 4 mois, lundi au vendredi)", () => {
  it("vaut 10 % de la course, tronqué, en plus des 15 % de l'entreprise", () => {
    expect(pricing.phoneCommissionPct()).toBe(10);
    expect(pricing.phoneCommission(1000)).toBe(100);
    expect(pricing.phoneCommission(1555)).toBe(155);
    expect(pricing.rideCommission({ profile: "ZEM_INDEPENDANT" }, 1000)).toBe(150);
  });

  it("est due du lundi au vendredi après la remise du téléphone", () => {
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2026-10-22T10:00:00Z"), 1000)).toBe(100); // jeudi
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2026-10-23T10:00:00Z"), 1000)).toBe(100); // vendredi
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2026-10-26T10:00:00Z"), 1000)).toBe(100); // lundi
  });

  it("n'est pas due le week-end (samedi et dimanche exclus)", () => {
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2026-10-24T10:00:00Z"), 1000)).toBe(0); // samedi
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2026-10-25T10:00:00Z"), 1000)).toBe(0); // dimanche
  });

  it("suit l'heure du Bénin (UTC+1) : vendredi 23h30 UTC est déjà samedi (exclu), dimanche 23h30 UTC est déjà lundi (compté)", () => {
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2026-10-23T23:30:00Z"), 1000)).toBe(0);
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2026-10-25T23:30:00Z"), 1000)).toBe(100);
  });

  it("n'est pas due avant la remise du téléphone, ni sans téléphone fourni", () => {
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2026-10-19T10:00:00Z"), 1000)).toBe(0); // lundi précédent
    expect(pricing.phoneCommissionFor(null, new Date("2026-10-22T10:00:00Z"), 1000)).toBe(0);
    expect(pricing.phoneCommissionFor(undefined, new Date("2026-10-22T10:00:00Z"), 1000)).toBe(0);
  });

  it("s'arrête toute seule après 4 mois (20 février 2027)", () => {
    expect(pricing.phoneSupportEnd(supportedAt).toISOString()).toBe("2027-02-20T10:00:00.000Z");
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2027-02-19T09:00:00Z"), 1000)).toBe(100); // vendredi, avant la fin
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2027-02-22T12:00:00Z"), 1000)).toBe(0); // lundi, mais les 4 mois sont écoulés
    expect(pricing.phoneCommissionFor(supportedAt, new Date("2027-03-08T12:00:00Z"), 1000)).toBe(0);
  });
});

describe("Commission téléphone : paiement d'une course", () => {
  afterEach(() => jest.useRealTimers());

  /** Paie une course de 1 000 F au moment `when` avec un Speeder dont le dossier porte (ou non) la date de remise du téléphone. */
  async function pay(provider: { phoneSupportedAt: Date | null } | null, when: string) {
    // seule la date est simulée : les promesses et minuteries continuent de tourner normalement
    jest.useFakeTimers({ now: new Date(when), doNotFake: ["nextTick", "setImmediate", "setInterval", "setTimeout", "clearImmediate", "clearInterval", "clearTimeout", "queueMicrotask"] });
    const created: any[] = [];
    const credits: { amount: number; label?: string }[] = [];
    const ride: any = { id: "ride-1", clientId: "client-1", price: 1000, traveledMeters: 1000 };
    const tx: any = {
      wallet: { upsert: jest.fn().mockResolvedValue({ id: "w" }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
      transaction: { createMany: jest.fn(async ({ data }: any) => { created.push(...data); return { count: data.length }; }) },
      ride: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ ...ride, status: "COMPLETED" }) },
    };
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ agency: null, provider }) },
      providerProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ride: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const wallet: any = { creditPlatformInTx: jest.fn(async (_tx: any, amount: number, _ref: string, label?: string) => { credits.push({ amount, label }); return true; }) };
    const notifications = { push: jest.fn().mockResolvedValue({}) };
    const gateway: any = { clearRideLocations: jest.fn(), emitStatus: jest.fn(), emitRideSettled: jest.fn() };
    const realPricing: any = Object.assign(Object.create(pricing), { agencyCanOperate: () => true });
    const service: any = new RidesService(prisma, wallet, notifications as any, realPricing, gateway);
    await service.settle(ride, "driver-1", { amount: 1000, settledDistanceMeters: 1000, priceMode: "FULL" });
    return { created, credits, tx, notifications };
  }
  const SATURDAY = "2026-10-24T10:00:00Z";
  const THURSDAY = "2026-10-22T10:00:00Z";

  it("sans téléphone fourni : seulement les 15 % de l'entreprise, même en semaine", async () => {
    const { created, credits, tx } = await pay({ phoneSupportedAt: null }, THURSDAY);
    // lignes du Speeder uniquement (le débit du client, « TRANSACTION_RIDE_PAYMENT », est à part)
    const debits = created.filter((t) => t.type === "DEBIT" && t.labelKey && t.labelKey !== "TRANSACTION_RIDE_PAYMENT");
    expect(debits.map((t) => t.labelKey)).toEqual(["TRANSACTION_PLATFORM_COMMISSION"]);
    expect(credits.map((c) => c.amount)).toEqual([150, 0]);
    expect(tx.ride.updateMany.mock.calls[0][0].data.phoneCommission).toBe(0);
  });

  it("téléphone fourni, un jeudi : 15 % pour l'entreprise PLUS 10 % de commission téléphone, le Speeder reçoit 75 %", async () => {
    const { created, credits, tx, notifications } = await pay({ phoneSupportedAt: supportedAt }, THURSDAY);
    const phoneLine = created.find((t) => t.labelKey === "TRANSACTION_PHONE_COMMISSION");
    expect(phoneLine).toMatchObject({ type: "DEBIT", amount: 100, label: "Commission téléphone (10 %)" });
    expect(created.find((t) => t.labelKey === "TRANSACTION_PLATFORM_COMMISSION")).toMatchObject({ amount: 150 });
    // le Speeder est crédité de la course entière puis débité des deux commissions : net = 1000 − 150 − 100 = 750
    expect(tx.wallet.update.mock.calls.find((c: any[]) => c[0].data.balance?.increment === 750)).toBeDefined();
    expect(credits).toEqual([
      { amount: 150, label: undefined },
      { amount: 100, label: "Commission téléphone (à reverser aux boutiques)" },
    ]);
    expect(tx.ride.updateMany.mock.calls[0][0].data).toMatchObject({ commission: 150, phoneCommission: 100 });
    const message = notifications.push.mock.calls.find((c: any[]) => c[1] === "Paiement reçu");
    expect(message[2]).toContain("commission téléphone");
    expect(message[2]).toContain("+750");
  });

  it("téléphone fourni, un samedi : pas de commission téléphone (les week-ends sont exclus)", async () => {
    const { created, credits, tx } = await pay({ phoneSupportedAt: supportedAt }, SATURDAY);
    expect(created.find((t) => t.labelKey === "TRANSACTION_PHONE_COMMISSION")).toBeUndefined();
    expect(credits.map((c) => c.amount)).toEqual([150, 0]);
    expect(tx.ride.updateMany.mock.calls[0][0].data.phoneCommission).toBe(0);
  });

  it("téléphone fourni il y a plus de 4 mois : plus de commission téléphone, même en semaine", async () => {
    const { created, tx } = await pay({ phoneSupportedAt: new Date("2026-05-01T10:00:00Z") }, THURSDAY);
    expect(created.find((t) => t.labelKey === "TRANSACTION_PHONE_COMMISSION")).toBeUndefined();
    expect(tx.ride.updateMany.mock.calls[0][0].data.phoneCommission).toBe(0);
  });
});
