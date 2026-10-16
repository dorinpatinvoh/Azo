jest.mock("@prisma/client", () => ({
  Role: { CLIENT: "CLIENT", DRIVER: "DRIVER" },
  VehicleType: { ZEM_ESSENCE: "ZEM_ESSENCE", ZEM_ELECTRIC: "ZEM_ELECTRIC", GAZELLE: "GAZELLE", KOALA: "KOALA", LEOPARD: "LEOPARD" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class NotificationsService {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class RidesGateway {} }));
jest.mock("../src/rides/standing", () => ({ assertClientAllowed: jest.fn().mockResolvedValue(undefined), assertDriverAllowed: jest.fn().mockResolvedValue(undefined) }));

import { ConflictException } from "@nestjs/common";
import { RidesService } from "../src/rides/rides.service";

const dto: any = { originLat: 6.37, originLng: 2.39, destLat: 6.4, destLng: 2.4, vehicleType: "ZEM_ESSENCE" };

function make(active: any) {
  const prisma: any = {
    ride: {
      findFirst: jest.fn().mockResolvedValue(active),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "new", ...data })),
    },
    user: { findUnique: jest.fn().mockResolvedValue({}) },
  };
  const pricing: any = { radarSettings: jest.fn().mockReturnValue({ pendingExpiryMinutes: 20 }) };
  const gateway: any = { emitNewRequest: jest.fn() };
  const service = new RidesService(prisma, {} as any, { push: jest.fn() } as any, pricing, gateway);
  jest.spyOn(service as any, "estimate").mockResolvedValue({ price: 1000 });
  jest.spyOn(service as any, "notifyMatchingDrivers").mockResolvedValue(0);
  return { service, prisma };
}

describe("pas de course en double pour un même client", () => {
  const existing = { id: "r1", clientId: "c1", status: "PENDING", pickupCode: "1234", vehicleType: "ZEM_ESSENCE", originLat: 6.37, originLng: 2.39, destLat: 6.4, destLng: 2.4 };

  it("le même trajet renvoyé (double appui) rend la course existante sans en créer une seconde", async () => {
    const { service, prisma } = make(existing);
    const ride: any = await service.create("c1", dto);
    expect(ride.id).toBe("r1");
    expect(prisma.ride.create).not.toHaveBeenCalled();
  });

  it("un autre trajet pendant qu'une course est active est refusé", async () => {
    const { service, prisma } = make({ ...existing, status: "IN_PROGRESS" });
    await expect(service.create("c1", { ...dto, destLat: 6.5, destLng: 2.5 })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.ride.create).not.toHaveBeenCalled();
  });

  it("sans course active, la demande est créée", async () => {
    const { service, prisma } = make(null);
    await service.create("c1", dto);
    expect(prisma.ride.create).toHaveBeenCalledTimes(1);
  });
});
