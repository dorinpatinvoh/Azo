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
  const wallet = { transfer: jest.fn().mockResolvedValue(undefined) };
  const notifications = { push: jest.fn().mockResolvedValue({}) };
  const pricing = {
    isZem: jest.fn().mockReturnValue(true),
    agencyCanOperate: jest.fn().mockReturnValue(true),
    rideCommission: jest.fn().mockReturnValue(0),
    radarSettings: jest.fn().mockReturnValue({ pendingExpiryMinutes: 20 }),
  };
  const gateway = { emitStatus: jest.fn() };
  const service = new RidesService(prisma as any, wallet as any, notifications as any, pricing as any, gateway as any);
  return { service, prisma, wallet, notifications, gateway, ride };
}

describe("code d'arrivée (dropCode) demandé par le Zem", () => {
  it("génère le code, prévient le client et ne le montre pas au Zem", async () => {
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

describe("fin de course par le Zem avec le code d'arrivée", () => {
  it("refuse si le code n'a pas encore été demandé", async () => {
    const { service, wallet } = makeService();
    await expect(service.complete("ride-1", driverId, "4829")).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.transfer).not.toHaveBeenCalled();
  });

  it.each([[undefined], [""], ["1111"], ["abcd"], ["482"]])("refuse le code %p, sans paiement", async (code) => {
    const { service, wallet } = makeService({ dropCode: "4829" });
    await expect(service.complete("ride-1", driverId, code as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.transfer).not.toHaveBeenCalled();
  });

  it("accepte le bon code : paiement et statut COMPLETED", async () => {
    const { service, wallet, prisma, gateway } = makeService({ dropCode: "4829" });
    const result: any = await service.complete("ride-1", driverId, "4829");
    expect(wallet.transfer).toHaveBeenCalledTimes(1);
    expect(prisma.ride.update.mock.calls[0][0].data.status).toBe("COMPLETED");
    expect(gateway.emitStatus).toHaveBeenCalledWith("ride-1", "COMPLETED");
    expect(result).not.toHaveProperty("dropCode");
  });

  it("la confirmation du client termine la course sans code", async () => {
    const { service, wallet } = makeService();
    await service.completeConfirmedByClient("ride-1", driverId);
    expect(wallet.transfer).toHaveBeenCalledTimes(1);
  });
});

describe("visibilité du code d'arrivée", () => {
  it("le client le voit pendant IN_PROGRESS, pas le Zem", async () => {
    const { service } = makeService({ dropCode: "4829" });
    const asClient: any = await service.findOne("ride-1", clientId);
    const asDriver: any = await service.findOne("ride-1", driverId);
    expect(asClient.dropCode).toBe("4829");
    expect(asDriver).not.toHaveProperty("dropCode");
  });

  it("le client ne le voit pas tant que le Zem ne l'a pas demandé", async () => {
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
