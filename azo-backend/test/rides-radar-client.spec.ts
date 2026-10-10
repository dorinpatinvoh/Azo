jest.mock("@prisma/client", () => ({
  VehicleType: {
    ZEM_ESSENCE: "ZEM_ESSENCE",
    ZEM_ELECTRIC: "ZEM_ELECTRIC",
    GAZELLE: "GAZELLE",
    KOALA: "KOALA",
    LEOPARD: "LEOPARD",
  },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {} }));
jest.mock("../src/notifications/notifications.module", () => ({
  NotificationsService: class NotificationsService {},
}));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class RidesGateway {} }));

import { RidesService } from "../src/rides/rides.service";

function makeService() {
  const pendingRide = {
    id: "ride-1",
    clientId: "client-1",
    status: "PENDING",
    vehicleType: "ZEM_ESSENCE",
    originLat: 6.37,
    originLng: 2.39,
    destLat: 6.4,
    destLng: 2.42,
    price: 1000,
    pickupCode: "0472",
    createdAt: new Date(),
    client: { fullName: "Amine" },
  };
  const findMany = jest.fn().mockResolvedValue([pendingRide]);
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ provider: { type: "DRIVER", vehicleType: "ZEM_ESSENCE" } }) },
    ride: { findMany },
  };
  const pricing = {
    radarSettings: jest.fn().mockReturnValue({ pendingExpiryMinutes: 20, searchRadiusKm: 0 }),
    rideVisibleFor: jest.fn().mockReturnValue(true),
  };
  const service = new RidesService(prisma as any, {} as any, {} as any, pricing as any, {} as any);
  return { service, findMany };
}

describe("radar du Zem : destination et pseudo du client", () => {
  it("demande uniquement le fullName du client à la base", async () => {
    const { service, findMany } = makeService();
    await service.pending("driver-1");
    expect(findMany.mock.calls[0][0].include).toEqual({ client: { select: { fullName: true } } });
  });

  it("renvoie la destination et le pseudo, sans le code de prise en charge ni le téléphone", async () => {
    const { service } = makeService();
    const [ride] = (await service.pending("driver-1")) as any[];
    expect(ride.client).toEqual({ fullName: "Amine" });
    expect(ride.destLat).toBe(6.4);
    expect(ride.destLng).toBe(2.42);
    expect(ride).not.toHaveProperty("pickupCode");
    expect(ride.client).not.toHaveProperty("phone");
  });
});
