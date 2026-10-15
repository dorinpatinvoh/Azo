/** Courses programmées (ouverture aux chauffeurs, radar, acceptation) et note du client par le chauffeur. */
jest.mock("@prisma/client", () => ({
  VehicleType: { ZEM_ESSENCE: "ZEM_ESSENCE", ZEM_ELECTRIC: "ZEM_ELECTRIC", GAZELLE: "GAZELLE", KOALA: "KOALA", LEOPARD: "LEOPARD" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class RidesGateway {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class NotificationsService {} }));

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { RidesService } from "../src/rides/rides.service";
import { RideExtrasService } from "../src/rides/ride-extras.service";
import { clientStatsFor } from "../src/rides/client-stats";
import {
  SCHEDULE_MAX_DAYS,
  SCHEDULE_MIN_LEAD_MIN,
  SCHEDULE_RELEASE_LEAD_MIN,
  isWaitingForRelease,
  parseSchedule,
  releaseAt,
  withReleaseAsCreation,
} from "../src/rides/schedule";

const NOW = new Date("2026-10-13T12:00:00Z");
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe("règles des courses programmées", () => {
  it(`exige ${SCHEDULE_MIN_LEAD_MIN} minutes d'avance au moins`, () => {
    expect(() => parseSchedule(inMinutes(10).toISOString(), NOW)).toThrow(BadRequestException);
    expect(parseSchedule(inMinutes(SCHEDULE_MIN_LEAD_MIN + 1).toISOString(), NOW)).toBeInstanceOf(Date);
  });
  it(`refuse au-delà de ${SCHEDULE_MAX_DAYS} jours, une date passée et une date invalide`, () => {
    expect(() => parseSchedule(inMinutes(SCHEDULE_MAX_DAYS * 1440 + 60).toISOString(), NOW)).toThrow(BadRequestException);
    expect(() => parseSchedule(inMinutes(-5).toISOString(), NOW)).toThrow(BadRequestException);
    expect(() => parseSchedule("pas une date", NOW)).toThrow(BadRequestException);
  });
  it("la demande s'ouvre 15 minutes avant l'heure souhaitée", () => {
    expect(releaseAt(inMinutes(60)).getTime()).toBe(inMinutes(60 - SCHEDULE_RELEASE_LEAD_MIN).getTime());
  });
  it("attente d'ouverture, puis délai d'attente compté depuis l'ouverture", () => {
    const base = { createdAt: new Date("2026-10-12T08:00:00Z"), scheduledAt: inMinutes(60) };
    expect(isWaitingForRelease({ ...base, scheduledReleasedAt: null })).toBe(true);
    expect(isWaitingForRelease({ ...base, scheduledReleasedAt: NOW })).toBe(false);
    expect(isWaitingForRelease({ createdAt: base.createdAt, scheduledAt: null })).toBe(false);
    expect(withReleaseAsCreation({ ...base, scheduledReleasedAt: NOW }).createdAt).toEqual(NOW);
    expect(withReleaseAsCreation({ createdAt: base.createdAt, scheduledAt: null }).createdAt).toEqual(base.createdAt);
  });
});

function makeRidesService(opts: { due?: any[]; releasedCount?: number; check?: any } = {}) {
  const prisma: any = {
    ride: {
      findMany: jest.fn().mockResolvedValue(opts.due ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: opts.releasedCount ?? 1 }),
      findUnique: jest.fn().mockResolvedValue(opts.check ?? null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ firstName: "Kossi", lastName: "Adjovi", fullName: "Kossi Adjovi" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const notifications: any = { push: jest.fn().mockResolvedValue({}) };
  const pricing: any = {
    radarSettings: jest.fn().mockReturnValue({ pendingExpiryMinutes: 20, driverNotificationMax: 20 }),
    rideSettings: jest.fn().mockReturnValue({ offerExpirySeconds: 45, requireClientApproval: true, offerApprovalGraceSeconds: 5 }),
    rideVisibleFor: jest.fn().mockReturnValue(true),
    vehicleLabel: jest.fn().mockReturnValue("Spider"),
  };
  const gateway: any = { emitNewRequest: jest.fn(), invalidateRideLocationContext: jest.fn() };
  return { service: new RidesService(prisma, {} as any, notifications, pricing, gateway), prisma, notifications, gateway };
}

describe("ouverture des courses programmées", () => {
  const due = { id: "r1", clientId: "c1", vehicleType: "ZEM_ESSENCE", price: 1500, originLat: 6.37, originLng: 2.39, status: "PENDING", scheduledAt: inMinutes(10) };

  it("publie la demande une fois et prévient le client", async () => {
    const { service, prisma, gateway, notifications } = makeRidesService({ due: [due] });
    expect(await service.releaseDueScheduledRides(NOW)).toBe(1);
    expect(prisma.ride.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "PENDING", scheduledReleasedAt: null }) })
    );
    expect(prisma.ride.updateMany).toHaveBeenCalledWith({ where: { id: "r1", status: "PENDING", scheduledReleasedAt: null }, data: { scheduledReleasedAt: NOW } });
    expect(gateway.emitNewRequest).toHaveBeenCalledWith(expect.objectContaining({ rideId: "r1", vehicleType: "ZEM_ESSENCE" }));
    expect(notifications.push).toHaveBeenCalledWith("c1", expect.any(String), expect.any(String), "ride", expect.anything());
  });

  it("ne republie pas une demande déjà ouverte (écriture conditionnelle)", async () => {
    const { service, gateway } = makeRidesService({ due: [due], releasedCount: 0 });
    expect(await service.releaseDueScheduledRides(NOW)).toBe(0);
    expect(gateway.emitNewRequest).not.toHaveBeenCalled();
  });

  it("un Spider ne peut pas accepter une course programmée pas encore ouverte", async () => {
    const { service } = makeRidesService({
      check: { id: "r1", status: "PENDING", declinedDriverIds: [], createdAt: new Date(), scheduledAt: inMinutes(120), scheduledReleasedAt: null },
    });
    (service as any).assertDriverIsFree = jest.fn().mockResolvedValue(undefined);
    await expect(service.accept("r1", "d1")).rejects.toThrow(/programmée/);
  });
});

describe("ouverture paresseuse (serveur réveillé par une requête)", () => {
  it("le balayage n'a lieu qu'une fois toutes les 15 secondes", async () => {
    const { service, prisma } = makeRidesService({ due: [] });
    (service as any).sweepScheduledRides();
    (service as any).sweepScheduledRides();
    await new Promise((r) => setImmediate(r));
    expect(prisma.ride.findMany).toHaveBeenCalledTimes(1);
  });

  it("un échec du balayage ne remonte jamais à l'appelant", async () => {
    const { service, prisma } = makeRidesService();
    prisma.ride.findMany.mockRejectedValue(new Error("base indisponible"));
    expect(() => (service as any).sweepScheduledRides()).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});

describe("note du client par le chauffeur", () => {
  const done = { id: "r1", driverId: "d1", status: "COMPLETED", clientRating: null, completedAt: new Date("2026-10-13T11:00:00Z") };
  function make(ride: any) {
    const prisma: any = { ride: { findUnique: jest.fn().mockResolvedValue(ride), update: jest.fn().mockResolvedValue({}) } };
    return { service: new RideExtrasService(prisma, {} as any), prisma };
  }

  it("enregistre la note une seule fois", async () => {
    const { service, prisma } = make(done);
    await expect(service.rateClient("r1", "d1", 4, NOW)).resolves.toEqual({ rated: true, stars: 4 });
    expect(prisma.ride.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { clientRating: 4, clientRatedAt: NOW } });
    await expect(make({ ...done, clientRating: 5 }).service.rateClient("r1", "d1", 3, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("réservé au chauffeur de la course, course terminée, dans les 48 h", async () => {
    await expect(make(done).service.rateClient("r1", "intrus", 4, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(make({ ...done, status: "IN_PROGRESS" }).service.rateClient("r1", "d1", 4, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(make({ ...done, completedAt: new Date("2026-10-10T12:00:00Z") }).service.rateClient("r1", "d1", 4, NOW)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});

describe("statistiques d'un client sur le radar", () => {
  it("note moyenne arrondie, nombre de notes et de courses ; zéros sans historique", async () => {
    const prisma: any = {
      ride: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([{ clientId: "c1", _count: { _all: 12 } }])
          .mockResolvedValueOnce([{ clientId: "c1", _count: { _all: 3 }, _avg: { clientRating: 4.6666 } }]),
      },
    };
    const stats = await clientStatsFor(prisma, ["c1", "c2", "c1"]);
    expect(stats!.get("c1")).toEqual({ rating: 4.7, ratedCount: 3, rides: 12 });
    expect(stats!.get("c2")).toEqual({ rating: null, ratedCount: 0, rides: 0 });
  });

  it("renvoie null (radar sans chiffres) si le calcul échoue", async () => {
    expect(await clientStatsFor({ ride: {} }, ["c1"])).toBeNull();
  });
});
