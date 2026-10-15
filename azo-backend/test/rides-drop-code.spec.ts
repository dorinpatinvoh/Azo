jest.mock("@prisma/client", () => ({
  Role: { CLIENT: "CLIENT", DRIVER: "DRIVER" },
  VehicleType: { ZEM_ESSENCE: "ZEM_ESSENCE", ZEM_ELECTRIC: "ZEM_ELECTRIC", GAZELLE: "GAZELLE", KOALA: "KOALA", LEOPARD: "LEOPARD" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class NotificationsService {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class RidesGateway {} }));

import { BadRequestException } from "@nestjs/common";
import { RidesService } from "../src/rides/rides.service";

const clientId = "client-1";
const driverId = "driver-1";

function makeService(overrides: Record<string, unknown> = {}) {
  const ride: any = {
    id: "ride-1",
    clientId,
    driverId,
    status: "IN_PROGRESS",
    vehicleType: "ZEM_ESSENCE",
    price: 1000,
    traveledMeters: 1000,
    destLat: 6.37,
    destLng: 2.39,
    odoLat: 6.37,
    odoLng: 2.39,
    odoAt: new Date(),
    pickupCode: null,
    dropCode: null,
    createdAt: new Date(),
    client: { fullName: "Amine", phone: "+2290197000042" },
    ...overrides,
  };
  const prisma = {
    ride: {
      findUnique: jest.fn().mockResolvedValue(ride),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...ride, dropCode: "4829" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({ ...ride, status: "COMPLETED" }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ agency: null, provider: null }) },
  };
  const tx = {
    wallet: {
      upsert: jest.fn().mockResolvedValue({ id: "wallet-1" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    transaction: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    ride: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...ride,
        status: "COMPLETED",
        finalPrice: ride.price,
        settledDistanceMeters: ride.traveledMeters,
        priceMode: "FULL",
      }),
    },
  };
  const $transaction = jest.fn((callback) => callback(tx));
  (prisma as any).$transaction = $transaction;
  const wallet = { transfer: jest.fn().mockResolvedValue(undefined), creditPlatformInTx: jest.fn().mockResolvedValue(true) };
  const notifications = { push: jest.fn().mockResolvedValue({}) };
  const pricing = {
    isZem: jest.fn().mockReturnValue(true),
    agencyCanOperate: jest.fn().mockReturnValue(true),
    rideCommission: jest.fn().mockReturnValue(0),
    radarSettings: jest.fn().mockReturnValue({ pendingExpiryMinutes: 20 }),
    rideSettings: jest.fn().mockReturnValue({
      stopRequestExpiryMinutes: 2,
      destinationToleranceMeters: 150,
      routeCacheSeconds: 5,
    }),
    breakdown: jest.fn((_distance, _vehicleType) => ({ price: ride.price })),
  };
  const gateway = {
    emitStatus: jest.fn(),
    clearRideLocations: jest.fn(),
    clearClientLocationState: jest.fn(),
    emitRideSettled: jest.fn(),
    emitStopRequest: jest.fn(),
    invalidateRideLocationContext: jest.fn(),
    freezeRideProgress: jest.fn().mockResolvedValue({
      traveledMeters: ride.traveledMeters,
      pendingMeters: 0,
      dirtyOdometer: false,
      odometer: null,
      currentPrice: ride.price,
    }),
  };
  const service = new RidesService(prisma as any, wallet as any, notifications as any, pricing as any, gateway as any);
  return { service, prisma, tx, $transaction, wallet, notifications, gateway, ride };
}

describe("code d'arrivée (dropCode) demandé par le Spider", () => {
  it("génère le code, prévient le client et ne le montre pas au Spider", async () => {
    const { service, prisma, notifications } = makeService();
    const result: any = await service.requestDropCode("ride-1", driverId);

    const call = prisma.ride.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "ride-1", driverId, status: "IN_PROGRESS", dropCode: null });
    expect(call.data.dropCode).toMatch(/^\d{4}$/);
    expect(notifications.push).toHaveBeenCalledWith(
      clientId, "Confirme ton arrivée", expect.any(String), "ride", expect.objectContaining({ sendPush: true })
    );
    expect(result.dropCodeRequested).toBe(true);
    expect(result).not.toHaveProperty("dropCode");
    expect(result).not.toHaveProperty("pickupCode");
  });

  it("est idempotent : un code déjà généré n'est pas regénéré", async () => {
    const { service, prisma, notifications } = makeService({ dropCode: "4829" });
    await service.requestDropCode("ride-1", driverId);
    expect(prisma.ride.updateMany).not.toHaveBeenCalled();
    expect(notifications.push).not.toHaveBeenCalled();
  });

  it("n'est possible que pendant la course", async () => {
    const { service } = makeService({ status: "ARRIVED" });
    await expect(service.requestDropCode("ride-1", driverId)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("fin de course par le Spider avec le code d'arrivée", () => {
  it("refuse si le code n'a pas encore été demandé", async () => {
    const { service, $transaction } = makeService();
    await expect(service.complete("ride-1", driverId, "4829")).rejects.toBeInstanceOf(BadRequestException);
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each([[undefined], [""], ["1111"], ["abcd"], ["482"]])("refuse le code %p, sans paiement", async (code) => {
    const { service, $transaction } = makeService({ dropCode: "4829" });
    await expect(service.complete("ride-1", driverId, code as any)).rejects.toBeInstanceOf(BadRequestException);
    expect($transaction).not.toHaveBeenCalled();
  });

  it("accepte le bon code : paiement et statut COMPLETED", async () => {
    const { service, tx, gateway, $transaction } = makeService({ dropCode: "4829" });
    const result: any = await service.complete("ride-1", driverId, "4829");
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.ride.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "COMPLETED",
        finalPrice: 1000,
        settledDistanceMeters: 1000,
        priceMode: "FULL",
        driverLat: null,
        clientLat: null,
      }),
    }));
    expect(gateway.clearRideLocations).toHaveBeenCalledWith("ride-1");
    expect(gateway.emitStatus).toHaveBeenCalledWith("ride-1", "COMPLETED");
    expect(result).not.toHaveProperty("dropCode");
  });

  it("la confirmation du client termine la course sans code", async () => {
    const { service, $transaction } = makeService();
    await service.completeConfirmedByClient("ride-1", driverId);
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});

describe("visibilité du code d'arrivée", () => {
  it("le client le voit pendant IN_PROGRESS, pas le Spider", async () => {
    const { service } = makeService({ dropCode: "4829" });
    const asClient: any = await service.findOne("ride-1", clientId);
    const asDriver: any = await service.findOne("ride-1", driverId);
    expect(asClient.dropCode).toBe("4829");
    expect(asDriver).not.toHaveProperty("dropCode");
  });

  it("le client ne le voit pas tant que le Spider ne l'a pas demandé", async () => {
    const { service } = makeService();
    const asClient: any = await service.findOne("ride-1", clientId);
    expect(asClient).not.toHaveProperty("dropCode");
  });

  it("il disparaît de l'historique", async () => {
    const { service, prisma } = makeService({ dropCode: "4829" });
    (prisma.ride as any).findMany = jest.fn().mockResolvedValue([{ id: "r", dropCode: "4829", pickupCode: "1", status: "IN_PROGRESS" }]);
    const [row]: any[] = await service.history(clientId);
    expect(row).not.toHaveProperty("dropCode");
    expect(row).not.toHaveProperty("pickupCode");
  });
});
