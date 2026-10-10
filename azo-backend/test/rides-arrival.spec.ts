import { BadRequestException } from "@nestjs/common";

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

const rideId = "ride-123";
const clientId = "client-123";
const driverId = "driver-123";
const pickupCode = "0472";

function makeService(status: string, code = pickupCode) {
  const ride = {
    id: rideId,
    clientId,
    driverId,
    status,
    pickupCode: code,
    driverArrivedAt: status === "ARRIVED" ? new Date() : null,
    vehicleType: "ZEM_ESSENCE",
    originLat: 6.37,
    originLng: 2.39,
    destLat: 6.38,
    destLng: 2.4,
    price: 1000,
    commission: 0,
    createdAt: new Date(),
  };
  const prisma = {
    ride: {
      findUnique: jest.fn().mockResolvedValue(ride),
      findUniqueOrThrow: jest.fn().mockResolvedValue(ride),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...ride, ...data })),
    },
    wallet: { findUnique: jest.fn().mockResolvedValue({ balance: 5000 }) },
  };
  const wallet = { transfer: jest.fn() };
  const notifications = { push: jest.fn().mockResolvedValue({}) };
  const pricing = {
    isZem: jest.fn().mockReturnValue(true),
    radarSettings: jest.fn().mockReturnValue({ pendingExpiryMinutes: 20 }),
  };
  const gateway = {
    emitStatus: jest.fn(),
    clearRideLocations: jest.fn(),
    clearClientLocationState: jest.fn(),
  };

  return {
    ride,
    prisma,
    notifications,
    gateway,
    service: new RidesService(prisma as any, wallet as any, notifications as any, pricing as any, gateway as any),
  };
}

describe("sécurisation de l'arrivée et du démarrage d'une course", () => {
  it("refuse un départ tant que le chauffeur n'a pas signalé son arrivée", async () => {
    const { service, prisma } = makeService("MATCHED");

    await expect(service.start(rideId, driverId, pickupCode)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    expect(prisma.ride.updateMany).not.toHaveBeenCalled();
  });

  it("refuse un code absent ou incorrect après l'arrivée", async () => {
    const { service, prisma } = makeService("ARRIVED");

    await expect(service.start(rideId, driverId, "1111")).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.start(rideId, driverId)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    expect(prisma.ride.updateMany).not.toHaveBeenCalled();
  });

  it("démarre avec le bon code et garde le secret hors de la réponse chauffeur", async () => {
    const { service, prisma, gateway } = makeService("ARRIVED");
    prisma.ride.findUniqueOrThrow.mockResolvedValue({
      ...makeService("IN_PROGRESS").ride,
      status: "IN_PROGRESS",
    });

    const result = await service.start(rideId, driverId, pickupCode);

    expect(prisma.ride.updateMany).toHaveBeenCalledWith({
      where: { id: rideId, driverId, status: "ARRIVED", pickupCode },
      data: expect.objectContaining({
        status: "IN_PROGRESS",
        pickupCode: null,
        clientLat: null,
        clientLng: null,
        clientLocatedAt: null,
      }),
    });
    expect(gateway.emitStatus).toHaveBeenCalledWith(rideId, "IN_PROGRESS");
    expect(gateway.clearClientLocationState).toHaveBeenCalledWith(rideId);
    expect(result).not.toHaveProperty("pickupCode");
  });

  it("notifie le client à l'arrivée et n'expose pas son code au chauffeur", async () => {
    const { service, prisma, notifications, gateway } = makeService("MATCHED");
    prisma.ride.findUniqueOrThrow.mockResolvedValue({ ...makeService("ARRIVED").ride, status: "ARRIVED" });

    const result = await service.arrive(rideId, driverId);

    expect(prisma.ride.updateMany).toHaveBeenCalledWith({
      where: { id: rideId, driverId, status: "MATCHED" },
      data: expect.objectContaining({ status: "ARRIVED", driverArrivedAt: expect.any(Date) }),
    });
    expect(notifications.push).toHaveBeenCalledWith(
      clientId,
      "Ton Zem est arrivé",
      expect.stringContaining("code Bouclier"),
      "ride",
      expect.objectContaining({ sendPush: true })
    );
    expect(gateway.emitStatus).toHaveBeenCalledWith(rideId, "ARRIVED");
    expect(result).not.toHaveProperty("pickupCode");
  });

  it("accepte un second appui sur « Je suis arrivé » sans erreur", async () => {
    const { service, prisma, gateway } = makeService("ARRIVED");

    const result = await service.arrive(rideId, driverId);

    expect(prisma.ride.updateMany).not.toHaveBeenCalled();
    expect(gateway.emitStatus).toHaveBeenCalledWith(rideId, "ARRIVED");
    expect(result).not.toHaveProperty("pickupCode");
  });

  it("n'échoue pas si la notification du client tombe en panne", async () => {
    const { service, prisma, notifications } = makeService("MATCHED");
    prisma.ride.findUniqueOrThrow.mockResolvedValue({ ...makeService("ARRIVED").ride, status: "ARRIVED" });
    notifications.push.mockRejectedValue(new Error("Expo indisponible"));

    await expect(service.arrive(rideId, driverId)).resolves.toMatchObject({ status: "ARRIVED" });
  });

  it("explique qu'il faut migrer la base si l'enum ARRIVED manque", async () => {
    const { service, prisma } = makeService("MATCHED");
    prisma.ride.updateMany.mockRejectedValue(
      new Error('invalid input value for enum "RideStatus": "ARRIVED"')
    );

    await expect(service.arrive(rideId, driverId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("ne renvoie le code que dans le détail client au statut ARRIVED", async () => {
    const { service } = makeService("ARRIVED");

    const clientView = (await service.findOne(rideId, clientId)) as { pickupCode?: string };
    const driverView = await service.findOne(rideId, driverId);

    expect(clientView.pickupCode).toBe(pickupCode);
    expect(driverView).not.toHaveProperty("pickupCode");
  });

  it("expose chaque dernière position uniquement à l'autre participant", async () => {
    const { service, ride } = makeService("ARRIVED");
    Object.assign(ride, {
      driverLat: 6.37,
      driverLng: 2.39,
      driverHeading: 92,
      driverSpeed: 3.5,
      driverLocatedAt: new Date("2026-10-10T12:00:00.000Z"),
      clientLat: 6.4,
      clientLng: 2.42,
      clientLocatedAt: new Date("2026-10-10T12:00:01.000Z"),
    });

    const clientView = await service.findOne(rideId, clientId);
    const driverView = await service.findOne(rideId, driverId);

    expect(clientView).toMatchObject({
      driverLocation: { lat: 6.37, lng: 2.39, heading: 92, speed: 3.5 },
    });
    expect(clientView).not.toHaveProperty("clientLocation");
    expect(clientView).not.toHaveProperty("driverLat");
    expect(driverView).toMatchObject({ clientLocation: { lat: 6.4, lng: 2.42 } });
    expect(driverView).not.toHaveProperty("driverLocation");
    expect(driverView).not.toHaveProperty("clientLat");
  });

  it("efface les positions du trajet à son annulation", async () => {
    const { service, prisma, gateway } = makeService("ARRIVED");

    await service.cancel(rideId, clientId);

    expect(prisma.ride.update).toHaveBeenCalledWith({
      where: { id: rideId },
      data: expect.objectContaining({
        status: "CANCELLED",
        driverLat: null,
        driverLng: null,
        driverHeading: null,
        driverSpeed: null,
        driverLocatedAt: null,
        clientLat: null,
        clientLng: null,
        clientLocatedAt: null,
      }),
    });
    expect(gateway.clearRideLocations).toHaveBeenCalledWith(rideId);
  });
});
