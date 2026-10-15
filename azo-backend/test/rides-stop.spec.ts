jest.mock("@prisma/client", () => ({
  Role: { CLIENT: "CLIENT", DRIVER: "DRIVER" },
  VehicleType: { ZEM_ESSENCE: "ZEM_ESSENCE", ZEM_ELECTRIC: "ZEM_ELECTRIC" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class NotificationsService {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class RidesGateway {} }));

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { RidesService } from "../src/rides/rides.service";

const clientId = "client-1";
const driverId = "driver-1";
const rideId = "ride-1";

function makeService(rideOverrides: Record<string, unknown> = {}) {
  const ride: any = {
    id: rideId,
    clientId,
    driverId,
    status: "IN_PROGRESS",
    vehicleType: "ZEM_ESSENCE",
    price: 1_000,
    traveledMeters: 1_000,
    stopRequestedBy: null,
    stopRequestedAt: null,
    stopRequestedPrice: null,
    stopRequestedDistanceMeters: null,
    ...rideOverrides,
  };
  const tx = {
    wallet: {
      upsert: jest.fn().mockResolvedValue({ id: "wallet" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    transaction: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    ride: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...ride, status: "COMPLETED" }),
    },
    rideTrackPoint: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    ride: {
      findUnique: jest.fn().mockResolvedValue(ride),
      findUniqueOrThrow: jest.fn().mockResolvedValue(ride),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ agency: null, provider: null }) },
    $transaction: jest.fn((callback) => callback(tx)),
  };
  const pricing: any = {
    breakdown: jest.fn().mockReturnValue({ price: 220 }),
    rideSettings: jest.fn().mockReturnValue({
      stopRequestExpiryMinutes: 2,
      destinationToleranceMeters: 150,
      routeCacheSeconds: 5,
    }),
    rideCommission: jest.fn().mockReturnValue(22),
    agencyCanOperate: jest.fn().mockReturnValue(true),
  };
  const notifications = { push: jest.fn().mockResolvedValue({}) };
  const gateway: any = {
    freezeRideProgress: jest.fn().mockResolvedValue({
      traveledMeters: 1_000,
      pendingMeters: 50,
      dirtyOdometer: true,
      odometer: { lat: 6.37, lng: 2.39, at: Date.now() },
      currentPrice: 220,
    }),
    invalidateRideLocationContext: jest.fn(),
    emitStopRequest: jest.fn(),
    clearRideLocations: jest.fn(),
    emitStatus: jest.fn(),
    emitRideSettled: jest.fn(),
  };
  return {
    service: new RidesService(prisma, {} as any, notifications as any, pricing, gateway),
    ride,
    prisma,
    tx,
    pricing,
    notifications,
    gateway,
  };
}

describe("accord bilatéral d'arrêt anticipé", () => {
  it("enregistre le prix et la distance figés, en vidant l'odomètre en attente", async () => {
    const { service, prisma, tx, gateway } = makeService();
    const result = await service.requestStop(rideId, clientId);

    expect(gateway.freezeRideProgress).toHaveBeenCalledWith(rideId);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      rideId,
      stopRequest: { by: "CLIENT", price: 220, distanceMeters: 1_000 },
    });
    expect(tx.ride.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stopRequestedPrice: 220,
          stopRequestedDistanceMeters: 1_000,
          traveledMeters: { increment: 50 },
        }),
      })
    );
  });

  it("accepter l'arrêt ne paie pas encore : un code d'arrivée est généré pour le client", async () => {
    const requestedAt = new Date();
    const { service, prisma, tx, gateway } = makeService({
      traveledMeters: 30,
      stopRequestedBy: "DRIVER",
      stopRequestedAt: requestedAt,
      stopRequestedPrice: 220,
      stopRequestedDistanceMeters: 30,
    });
    const result: any = await service.acceptStop(rideId, clientId);

    expect(result.stopRequest).toMatchObject({ by: "DRIVER", price: 220, accepted: true, codeRequired: true });
    expect(prisma.ride.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stopRequestedAt: requestedAt, stopAcceptedAt: null }),
        data: expect.objectContaining({ stopAcceptedAt: expect.any(Date), dropCode: expect.stringMatching(/^\d{4}$/) }),
      })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(gateway.emitStopRequest).toHaveBeenCalledWith(rideId, expect.objectContaining({ accepted: true }), { accepted: true });
    // le demandeur ne peut pas accepter sa propre demande
    await expect(service.acceptStop(rideId, driverId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("le Spider saisit le code : le client est débité du prix de la demande, sans exiger d'être à destination", async () => {
    const requestedAt = new Date();
    const { service, prisma, tx, pricing, gateway } = makeService({
      traveledMeters: 2_500,
      dropCode: "4821",
      stopRequestedBy: "DRIVER",
      stopRequestedAt: requestedAt,
      stopAcceptedAt: new Date(),
      stopRequestedPrice: 220,
      stopRequestedDistanceMeters: 1_000,
    });
    await expect(service.complete(rideId, driverId, "0000")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await service.complete(rideId, driverId, "4821");
    expect(pricing.rideCommission).toHaveBeenCalledWith(expect.anything(), 220);
    expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: "wallet" }, data: { balance: { increment: 198 } } });
    expect(tx.ride.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "IN_PROGRESS", stopRequestedAt: requestedAt, stopRequestedPrice: 220 }),
        data: expect.objectContaining({ status: "COMPLETED", finalPrice: 220, settledDistanceMeters: 1_000, priceMode: "PARTIAL", stopAcceptedAt: null }),
      })
    );
    expect(gateway.emitStatus).toHaveBeenCalledWith(rideId, "COMPLETED");
  });

  it("après acceptation, l'arrêt ne peut plus être refusé ni annulé", async () => {
    const { service } = makeService({
      dropCode: "4821",
      stopRequestedBy: "DRIVER",
      stopRequestedAt: new Date(),
      stopAcceptedAt: new Date(),
      stopRequestedPrice: 220,
    });
    await expect(service.cancelStop(rideId, driverId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.declineStop(rideId, clientId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("expire une demande après deux minutes et ne règle rien", async () => {
    const requestedAt = new Date(Date.now() - 121_000);
    const { service, prisma, gateway } = makeService({
      stopRequestedBy: "CLIENT",
      stopRequestedAt: requestedAt,
      stopRequestedPrice: 220,
    });

    await expect(service.acceptStop(rideId, driverId)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ride.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: rideId, status: "IN_PROGRESS", stopRequestedAt: requestedAt },
        data: expect.objectContaining({ stopRequestedBy: null, stopRequestedPrice: null }),
      })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(gateway.emitStopRequest).toHaveBeenCalledWith(rideId, null, { expired: true });
  });
});
