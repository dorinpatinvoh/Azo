jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {}, WalletModule: class {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class {}, NotificationsModule: class {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class {}, PricingModule: class {} }));

import { BadRequestException } from "@nestjs/common";
import { DeliveryService } from "../src/delivery/delivery.module";
import { PricingService } from "../src/pricing/pricing.service";

const pricing = new PricingService();

describe("Tarification coursier personnel et commission de 15 %", () => {
  it("calcule base + km × tarif selon le véhicule", () => {
    expect(pricing.personalCourierPrice("ZEM_ESSENCE", 10)).toBe(1500);
    expect(pricing.personalCourierPrice("ZEM_ELECTRIC", 10)).toBe(1500);
    expect(pricing.personalCourierPrice("GAZELLE", 10)).toBe(4000);
    expect(pricing.personalCourierPrice("KOALA", 10)).toBe(5500);
    expect(pricing.personalCourierPrice("LEOPARD", 10)).toBe(14000);
  });

  it("propose 5 h, 1 jour et 3 jours", () => {
    expect(pricing.personalCourierDurations().map((d) => d.hours)).toEqual([5, 24, 72]);
  });

  it("prélève 15 % hors agence ; les agences gardent la commission de leur niveau", () => {
    expect(pricing.rideCommission({ profile: "ZEM_INDEPENDANT" }, 1000)).toBe(150);
    expect(pricing.rideCommission({ agencyLevel: "DIAMANT" }, 1000)).toBe(pricing.agencyCommission("DIAMANT", 1000));
    expect(pricing.deliveryCommission(2000)).toBe(300);
  });

});

describe("Réservation d'un coursier personnel", () => {
  const make = (over: Record<string, unknown> = {}) => {
    const prisma: any = {
      providerProfile: { findUnique: jest.fn().mockResolvedValue({ type: "COURIER", categoryId: "COURSIER_PERSONNEL", vehicleType: "ZEM_ESSENCE" }) },
      delivery: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: "d1", clientId: "c1", mode: "PERSONAL", vehicleType: "ZEM_ESSENCE", bookingHours: 5 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "d1", clientId: "c1", dropAddress: "Fidjrossè", price: 1500, courierId: "k1" }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "d1", ...data })),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      ...over,
    };
    const wallet = { getWallet: jest.fn().mockResolvedValue({ balance: 50000 }) };
    const notifications = { push: jest.fn().mockResolvedValue(undefined) };
    return { prisma, wallet, service: new DeliveryService(prisma, wallet as any, notifications as any, pricing) };
  };

  it("refuse un autre client tant que la réservation n'est pas terminée", async () => {
    const { service, prisma } = make();
    prisma.delivery.findFirst.mockResolvedValueOnce({ id: "d0", bookedUntil: new Date(Date.now() + 3600_000) });
    await expect(service.accept("k1", "d1")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
  });

  it("fixe la fin de réservation à l'acceptation", async () => {
    const { service, prisma } = make();
    prisma.delivery.findFirst.mockResolvedValue(null);
    await service.accept("k1", "d1");
    const data = prisma.delivery.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("MATCHED");
    expect(data.bookedUntil.getTime() - Date.now()).toBeGreaterThan(4.9 * 3600_000);
  });

  it("refuse une mission d'un autre véhicule", async () => {
    const { service, prisma } = make();
    prisma.delivery.findUnique.mockResolvedValue({ id: "d1", clientId: "c1", mode: "PERSONAL", vehicleType: "GAZELLE", bookingHours: 5 });
    await expect(service.accept("k1", "d1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("calcule le prix côté serveur et ignore celui du client", async () => {
    const { service, prisma } = make();
    jest.spyOn(service as any, "routeKm").mockResolvedValue(10);
    await service.create("c1", {
      packageType: "personal",
      pickupAddress: "A",
      dropAddress: "B",
      payer: "RECEIVER",
      price: 200,
      mode: "PERSONAL",
      vehicleType: "GAZELLE",
      bookingHours: 24,
      pickupLat: 6.37,
      pickupLng: 2.39,
      dropLat: 6.4,
      dropLng: 2.4,
    } as any);
    const data = prisma.delivery.create.mock.calls[0][0].data;
    expect(data.price).toBe(4000);
    expect(data.payer).toBe("SENDER");
    expect(data.bookingHours).toBe(24);
  });

  it("refuse une durée non proposée", async () => {
    const { service } = make();
    await expect(
      service.create("c1", { packageType: "personal", pickupAddress: "A", dropAddress: "B", payer: "SENDER", mode: "PERSONAL", vehicleType: "KOALA", bookingHours: 7 } as any)
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
