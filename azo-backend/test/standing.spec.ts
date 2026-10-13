/** Règle de notation : avertissement et restriction, pour les clients (notés par les chauffeurs) et les chauffeurs (notés par les clients). */
jest.mock("@prisma/client", () => ({
  VehicleType: { ZEM_ESSENCE: "ZEM_ESSENCE", ZEM_ELECTRIC: "ZEM_ELECTRIC", GAZELLE: "GAZELLE", KOALA: "KOALA", LEOPARD: "LEOPARD" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class RidesGateway {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class NotificationsService {} }));

import { ForbiddenException } from "@nestjs/common";
import { RidesService } from "../src/rides/rides.service";
import {
  RATING_POLICY,
  assertClientAllowed,
  assertDriverAllowed,
  clientStanding,
  driverStanding,
  levelFor,
} from "../src/rides/standing";

const NOW = new Date("2026-10-13T12:00:00Z");
const DAY = 86_400_000;

function prismaWith(opts: { avg: number | null; count: number; reset?: Date | null; fail?: boolean }) {
  const aggregate = jest.fn().mockImplementation(() => {
    if (opts.fail) return Promise.reject(new Error("base en panne"));
    return Promise.resolve({ _avg: { clientRating: opts.avg, rating: opts.avg }, _count: { _all: opts.count } });
  });
  return {
    prisma: { user: { findUnique: jest.fn().mockResolvedValue({ ratingResetAt: opts.reset ?? null }) }, ride: { aggregate } } as any,
    aggregate,
  };
}

describe("seuils", () => {
  it("pas de règle sous le nombre minimal d'avis, même avec une très mauvaise moyenne", () => {
    expect(levelFor(1.0, RATING_POLICY.minRatings - 1)).toBe("OK");
    expect(levelFor(null, 0)).toBe("OK");
  });
  it("avertissement sous 3,5 ; restriction sous 3,0 ; exactement le seuil = pas de sanction", () => {
    expect(levelFor(4.2, 8)).toBe("OK");
    expect(levelFor(3.5, 8)).toBe("OK");
    expect(levelFor(3.4, 8)).toBe("WARNING");
    expect(levelFor(3.0, 8)).toBe("WARNING");
    expect(levelFor(2.9, 8)).toBe("RESTRICTED");
  });
});

describe("situation d'un client / d'un chauffeur", () => {
  it("client : lit clientRating sur les 30 derniers jours", async () => {
    const { prisma, aggregate } = prismaWith({ avg: 2.6, count: 6 });
    const s = await clientStanding(prisma, "c1", NOW);
    expect(s).toMatchObject({ role: "CLIENT", rating: 2.6, count: 6, level: "RESTRICTED", windowDays: 30 });
    const where = aggregate.mock.calls[0][0].where;
    expect(where.clientId).toBe("c1");
    expect(where.clientRating).toEqual({ not: null });
    expect(where.clientRatedAt.gte.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it("chauffeur : lit la note donnée par les clients, sur la même fenêtre", async () => {
    const { prisma, aggregate } = prismaWith({ avg: 3.3, count: 10 });
    const s = await driverStanding(prisma, "d1", NOW);
    expect(s).toMatchObject({ role: "DRIVER", rating: 3.3, level: "WARNING" });
    const where = aggregate.mock.calls[0][0].where;
    expect(where.driverId).toBe("d1");
    expect(where.rating).toEqual({ not: null });
    expect(where.completedAt.gte.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it("une remise à zéro par l'administrateur raccourcit la fenêtre", async () => {
    const reset = new Date(NOW.getTime() - 2 * DAY);
    const { prisma, aggregate } = prismaWith({ avg: 4.8, count: 1, reset });
    await clientStanding(prisma, "c1", NOW);
    expect(aggregate.mock.calls[0][0].where.clientRatedAt.gte).toEqual(reset);
    // une remise à zéro plus ancienne que la fenêtre ne change rien
    const old = prismaWith({ avg: 4.8, count: 1, reset: new Date(NOW.getTime() - 90 * DAY) });
    await clientStanding(old.prisma, "c1", NOW);
    expect(old.aggregate.mock.calls[0][0].where.clientRatedAt.gte.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it("moyenne arrondie au dixième, null sans avis", async () => {
    expect((await clientStanding(prismaWith({ avg: 4.666, count: 7 }).prisma, "c1", NOW)).rating).toBe(4.7);
    expect((await clientStanding(prismaWith({ avg: null, count: 0 }).prisma, "c1", NOW)).rating).toBeNull();
  });
});

describe("blocage", () => {
  it("client restreint : 403 avec le code CLIENT_RATING_TOO_LOW", async () => {
    const { prisma } = prismaWith({ avg: 2.4, count: 6 });
    await expect(assertClientAllowed(prisma, "c1")).rejects.toMatchObject({ response: { code: "CLIENT_RATING_TOO_LOW" } });
    await expect(assertClientAllowed(prisma, "c1")).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("chauffeur restreint : 403 avec le code DRIVER_RATING_TOO_LOW", async () => {
    await expect(assertDriverAllowed(prismaWith({ avg: 2.0, count: 9 }).prisma, "d1")).rejects.toMatchObject({
      response: { code: "DRIVER_RATING_TOO_LOW" },
    });
  });
  it("avertissement ou note correcte : passe", async () => {
    await expect(assertClientAllowed(prismaWith({ avg: 3.2, count: 9 }).prisma, "c1")).resolves.toBeUndefined();
    await expect(assertDriverAllowed(prismaWith({ avg: 4.9, count: 30 }).prisma, "d1")).resolves.toBeUndefined();
  });
  it("une panne de calcul ne bloque jamais une course", async () => {
    await expect(assertClientAllowed(prismaWith({ avg: 1, count: 99, fail: true }).prisma, "c1")).resolves.toBeUndefined();
  });
});

describe("branchement sur les courses", () => {
  function make(avg: number, count: number) {
    const { prisma } = prismaWith({ avg, count });
    const pricing: any = { radarSettings: jest.fn(), rideSettings: jest.fn() };
    return new RidesService(prisma, {} as any, {} as any, pricing, {} as any);
  }

  it("un client restreint ne peut pas demander de course", async () => {
    await expect(
      make(2.2, 6).create("c1", { originLat: 6.37, originLng: 2.39, destLat: 6.4, destLng: 2.42, vehicleType: "ZEM_ESSENCE" } as any)
    ).rejects.toMatchObject({ response: { code: "CLIENT_RATING_TOO_LOW" } });
  });

  it("un chauffeur restreint ne peut pas accepter de course", async () => {
    await expect(make(2.2, 6).accept("r1", "d1")).rejects.toMatchObject({ response: { code: "DRIVER_RATING_TOO_LOW" } });
  });
});
