jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {}, WalletModule: class {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class {}, NotificationsModule: class {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class {}, PricingModule: class {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class {} }));
jest.mock("../src/rides/rides.module", () => ({ RidesModule: class {} }));

import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
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
  // Par défaut : validation du client désactivée (la mission passe directement à MATCHED) ; `approval: true` pour tester la proposition
  const make = (over: Record<string, unknown> = {}, approval = false) => {
    jest.spyOn(pricing, "rideSettings").mockReturnValue({ ...PricingService.prototype.rideSettings.call(pricing), requireClientApproval: approval });
    const prisma: any = {
      providerProfile: { findUnique: jest.fn().mockResolvedValue({ type: "COURIER", status: "APPROVED", categoryId: "COURSIER_PERSONNEL", vehicleType: "ZEM_ESSENCE" }) },
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
    const wallet: any = { getWallet: jest.fn().mockResolvedValue({ balance: 50000 }) };
    const notifications = { push: jest.fn().mockResolvedValue(undefined) };
    const gateway = { emitToUser: jest.fn() };
    return { prisma, wallet, notifications, gateway, service: new DeliveryService(prisma, wallet as any, notifications as any, pricing, gateway as any) };
  };

  it("refuse un autre client tant que la réservation n'est pas terminée", async () => {
    const { service, prisma } = make();
    prisma.delivery.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "d0", bookedUntil: new Date(Date.now() + 3600_000) });
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

  it("accepte une destination absente : seule la base est facturée", async () => {
    const { service, prisma } = make();
    await service.create("c1", { packageType: "personal", pickupAddress: "A", payer: "SENDER", mode: "PERSONAL", vehicleType: "GAZELLE", bookingHours: 5, pickupLat: 6.37, pickupLng: 2.39 } as any);
    const data = prisma.delivery.create.mock.calls[0][0].data;
    expect(data.price).toBe(1000);
    expect(data.dropAddress).toContain("préciser");
  });

  it("exige une date de départ au-delà de 3 jours, et la garde en base", async () => {
    const { service, prisma } = make();
    const dto = { packageType: "personal", pickupAddress: "A", payer: "SENDER", mode: "PERSONAL", vehicleType: "KOALA", bookingHours: 120, pickupLat: 6.37, pickupLng: 2.39 } as any;
    await expect(service.create("c1", dto)).rejects.toBeInstanceOf(BadRequestException);
    const when = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
    await service.create("c1", { ...dto, scheduledAt: when });
    expect(prisma.delivery.create.mock.calls[0][0].data.scheduledAt).toEqual(new Date(when));
  });

  it("démarre la réservation à l'heure programmée", async () => {
    const { service, prisma } = make();
    const start = new Date(Date.now() + 2 * 24 * 3600_000);
    prisma.delivery.findUnique.mockResolvedValue({ id: "d1", clientId: "c1", mode: "PERSONAL", vehicleType: "ZEM_ESSENCE", bookingHours: 24, scheduledAt: start });
    await service.accept("k1", "d1");
    const data = prisma.delivery.updateMany.mock.calls[0][0].data;
    expect(data.bookedFrom).toEqual(start);
    expect(data.bookedUntil.getTime()).toBe(start.getTime() + 24 * 3600_000);
  });

  it("fait le point à la fin : base + kilomètres réellement parcourus, 15 % pour l'entreprise", async () => {
    const { service, prisma, wallet } = make();
    (wallet as any).settleDelivery = jest.fn().mockResolvedValue(undefined);
    prisma.delivery.findUnique.mockResolvedValue({ id: "d1", clientId: "c1", courierId: "k1", status: "IN_PROGRESS", mode: "PERSONAL", vehicleType: "KOALA", payer: "SENDER", price: 1000, traveledMeters: 12_000, distanceKm: 3, deliveryCode: "1234", dropAddress: "X" });
    prisma.delivery.update = jest.fn().mockResolvedValue({ id: "d1", clientId: "c1", price: 6400 });
    prisma.providerProfile.updateMany = jest.fn().mockResolvedValue({});
    await service.confirmDelivery("k1", "d1", "1234");
    // 1000 + 12 km × 450 = 6400 ; commission 15 % = 960 ; net 5440
    expect((wallet as any).settleDelivery).toHaveBeenCalledWith(expect.objectContaining({ price: 6400, commission: 960, net: 5440 }));
    expect(prisma.delivery.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ price: 6400, distanceKm: 12 }));
  });

  it("ne débite pas au-delà du solde du client", async () => {
    const { service, prisma, wallet } = make();
    (wallet as any).settleDelivery = jest.fn().mockResolvedValue(undefined);
    wallet.getWallet.mockResolvedValue({ balance: 2000 });
    prisma.delivery.findUnique.mockResolvedValue({ id: "d1", clientId: "c1", courierId: "k1", status: "IN_PROGRESS", mode: "PERSONAL", vehicleType: "KOALA", payer: "SENDER", price: 1000, traveledMeters: 12_000, deliveryCode: "1234", dropAddress: "X" });
    prisma.delivery.update = jest.fn().mockResolvedValue({ id: "d1", clientId: "c1", price: 2000 });
    prisma.providerProfile.updateMany = jest.fn().mockResolvedValue({});
    await service.confirmDelivery("k1", "d1", "1234");
    expect((wallet as any).settleDelivery).toHaveBeenCalledWith(expect.objectContaining({ price: 2000 }));
  });

  it("tarifie le Speeder tricycle : 300 F de base, 100/80/75 F par palier", () => {
    expect(pricing.ridePrice(10, "ZEM_TRICYCLE")).toBe(1300);
    expect(pricing.personalCourierPrice("ZEM_TRICYCLE", 10)).toBe(2100);
  });

  it("colis express : le livreur ne voit que les colis demandant son Speeder (ou sans préférence)", async () => {
    const { service, prisma } = make();
    prisma.providerProfile.findUnique.mockResolvedValue({ type: "COURIER", status: "APPROVED", categoryId: "COURSIER_EXPRESS", vehicleType: "ZEM_TRICYCLE" });
    await service.pending("k1");
    const where = prisma.delivery.findMany.mock.calls[0][0].where;
    expect(where.mode).toBe("EXPRESS");
    expect(where.OR).toEqual([{ vehicleType: null }, { vehicleType: "ZEM_TRICYCLE" }]);
  });

  it("refuse d'accepter un colis demandant un autre Speeder", async () => {
    const { service, prisma } = make();
    prisma.providerProfile.findUnique.mockResolvedValue({ type: "COURIER", status: "APPROVED", categoryId: "COURSIER_EXPRESS", vehicleType: "ZEM_ESSENCE" });
    prisma.delivery.findUnique.mockResolvedValue({ id: "d1", clientId: "c1", mode: "EXPRESS", vehicleType: "GAZELLE" });
    await expect(service.accept("k1", "d1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("colis : prix serveur = base du colis + km × tarif du Speeder (moto 70/km, tricycle 225 + 80/km)", async () => {
    const { service, prisma } = make();
    jest.spyOn(service as any, "routeKm").mockResolvedValue(10);
    const dto = { packageType: "small", pickupAddress: "A", dropAddress: "B", payer: "SENDER", price: 200, pickupLat: 6.37, pickupLng: 2.39, dropLat: 6.4, dropLng: 2.4 } as any;
    await service.create("c1", { ...dto, vehicleType: "ZEM_ESSENCE" });
    expect(prisma.delivery.create.mock.calls[0][0].data.price).toBe(820); // petit colis : 120 + 10 × 70
    await service.create("c1", { ...dto, packageType: "large", vehicleType: "ZEM_TRICYCLE" });
    expect(prisma.delivery.create.mock.calls[1][0].data.price).toBe(1025);
  });

  it("colis : une voiture ne livre pas, et les coordonnées sont obligatoires", async () => {
    const { service } = make();
    const dto = { packageType: "small", pickupAddress: "A", dropAddress: "B", payer: "SENDER", pickupLat: 6.37, pickupLng: 2.39, dropLat: 6.4, dropLng: 2.4 } as any;
    await expect(service.create("c1", { ...dto, vehicleType: "GAZELLE" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create("c1", { packageType: "small", pickupAddress: "A", dropAddress: "B", payer: "SENDER" } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("devis : A vers B à 1 km en Speeder à essence : document 170 F, petit colis 190 F, colis moyen 270 F ; tricycle 305 F", async () => {
    const { service } = make();
    jest.spyOn(service as any, "routeKm").mockResolvedValue(1);
    const a = { lat: 6.37, lng: 2.39 };
    const b = { lat: 6.38, lng: 2.4 };
    expect(await service.quote("ZEM_ESSENCE", "doc", a, b)).toEqual({ km: 1, price: 170 });
    expect(await service.quote("ZEM_ESSENCE", "small", a, b)).toEqual({ km: 1, price: 190 });
    expect(await service.quote("ZEM_ESSENCE", "medium", a, b)).toEqual({ km: 1, price: 270 });
    expect(await service.quote("ZEM_TRICYCLE", "large", a, b)).toEqual({ km: 1, price: 305 });
    await expect(service.quote("ZEM_ESSENCE", "large", a, b)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("gros colis : réservé au tricycle", async () => {
    const { service } = make();
    jest.spyOn(service as any, "routeKm").mockResolvedValue(2);
    const dto = { packageType: "large", pickupAddress: "A", dropAddress: "B", payer: "SENDER", pickupLat: 6.37, pickupLng: 2.39, dropLat: 6.4, dropLng: 2.4 } as any;
    await expect(service.create("c1", { ...dto, vehicleType: "ZEM_ESSENCE" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create("c1", { ...dto, vehicleType: "ZEM_TRICYCLE" })).resolves.toBeDefined();
  });

  it("le tricycle n'est plus sollicité tant qu'il ne s'agit pas d'un gros colis", async () => {
    const { service } = make();
    jest.spyOn(service as any, "routeKm").mockResolvedValue(1);
    const a = { lat: 6.37, lng: 2.39 };
    const b = { lat: 6.38, lng: 2.4 };
    for (const packageType of ["doc", "small", "medium"]) {
      await expect(service.quote("ZEM_TRICYCLE", packageType, a, b)).rejects.toBeInstanceOf(BadRequestException);
    }
    const dto = { packageType: "medium", pickupAddress: "A", dropAddress: "B", payer: "SENDER", vehicleType: "ZEM_TRICYCLE", pickupLat: 6.37, pickupLng: 2.39, dropLat: 6.4, dropLng: 2.4 } as any;
    await expect(service.create("c1", dto)).rejects.toThrow(/réservé aux gros colis/);
    await expect(service.quote("ZEM_TRICYCLE", "large", a, b)).resolves.toEqual({ km: 1, price: 305 });
  });

  it("un coursier occupé ou réservé ne se voit proposer aucune autre mission", async () => {
    const { service, prisma } = make();
    prisma.delivery.findFirst.mockResolvedValueOnce({ id: "d-en-cours" });
    await expect(service.pending("k1")).resolves.toEqual([]);
    expect(prisma.delivery.findMany).not.toHaveBeenCalled();
  });

  it("un client ou un Speeder de courses ne peut pas prendre une mission de colis", async () => {
    const { service, prisma } = make();
    for (const profile of [null, { type: "DRIVER", status: "APPROVED", vehicleType: "ZEM_ESSENCE" }, { type: "COURIER", status: "DRAFT", vehicleType: "ZEM_ESSENCE" }]) {
      prisma.providerProfile.findUnique.mockResolvedValue(profile);
      await expect(service.accept("u1", "d1")).rejects.toThrow(/validés/);
      await expect(service.pending("u1")).resolves.toEqual([]);
    }
  });

  it("un coursier voit les missions dans un rayon de 20 km autour de lui (ni 25 km, ni sans limite)", async () => {
    const { service, prisma } = make();
    prisma.delivery.findFirst.mockResolvedValue(null);
    const row = (id: string, lat: number) => ({ id, clientId: "c1", mode: "PERSONAL", status: "PENDING", pickupLat: lat, pickupLng: 2.39, dropLat: null, dropLng: null, price: 1000, client: { fullName: "C", phone: "0197000001" } });
    // 1° de latitude ≈ 111 km : 0,135° ≈ 15 km, 0,225° ≈ 25 km
    prisma.delivery.findMany.mockResolvedValue([row("proche", 6.37 + 0.135), row("loin", 6.37 + 0.225), row("sans-lieu", 0)].map((r, i) => (i === 2 ? { ...r, pickupLat: null, pickupLng: null } : r)));
    const list: any[] = await service.pending("k1", { lat: 6.37, lng: 2.39 });
    expect(list.map((d) => d.id).sort()).toEqual(["proche", "sans-lieu"]);
  });

  describe("proposition du coursier validée par le client", () => {
    const offered = (extra: Record<string, unknown> = {}) => ({
      id: "d1", clientId: "c1", courierId: "k1", status: "OFFERED", mode: "PERSONAL", bookingHours: 5, scheduledAt: null, price: 1500, pickupCode: "1234", deliveryCode: "5678",
      offerExpiresAt: new Date(Date.now() + 40_000), declinedCourierIds: [], ...extra,
    });

    it("accepter ne confirme pas : la mission passe à OFFERED et le client est prévenu", async () => {
      const { service, prisma, gateway } = make({}, true);
      prisma.delivery.findUniqueOrThrow.mockResolvedValue(offered());
      prisma.delivery.findUnique.mockResolvedValue({ id: "d1", clientId: "c1", mode: "PERSONAL", vehicleType: "ZEM_ESSENCE", bookingHours: 5, declinedCourierIds: [] });
      const result: any = await service.accept("k1", "d1", { lat: 6.37, lng: 2.39 });
      const data = prisma.delivery.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe("OFFERED");
      expect(data.courierId).toBe("k1");
      expect(data.offerExpiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(data.bookedFrom).toBeUndefined();
      expect(result.pickupCode).toBe("••••");
      expect(result.courier).toBeNull();
      void gateway;
    });

    it("un coursier refusé par le client ne peut plus reprendre la même mission", async () => {
      const { service, prisma } = make({}, true);
      prisma.delivery.findUnique.mockResolvedValue({ id: "d1", clientId: "c1", mode: "PERSONAL", vehicleType: "ZEM_ESSENCE", bookingHours: 5, declinedCourierIds: ["k1"] });
      await expect(service.accept("k1", "d1")).rejects.toThrow(/refusé/);
    });

    it("le client valide : MATCHED, réservation du coursier personnel fixée, coursier prévenu", async () => {
      const { service, prisma, gateway, notifications } = make();
      prisma.delivery.findUnique.mockResolvedValue(offered());
      prisma.delivery.findUniqueOrThrow.mockResolvedValue({ ...offered(), status: "MATCHED", price: 1500 });
      await service.approveCourier("d1", "c1");
      const data = prisma.delivery.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe("MATCHED");
      expect(data.bookedUntil.getTime() - data.bookedFrom.getTime()).toBe(5 * 3600_000);
      expect(gateway.emitToUser).toHaveBeenCalledWith("k1", "delivery:offer-approved", expect.anything());
      expect(notifications.push).toHaveBeenCalledWith("k1", expect.any(String), expect.any(String), "DELIVERY", expect.objectContaining({ titleKey: "NOTIFICATION_DELIVERY_APPROVED" }));
    });

    it("un autre client ne peut ni valider ni refuser", async () => {
      const { service, prisma } = make();
      prisma.delivery.findUnique.mockResolvedValue(offered());
      await expect(service.approveCourier("d1", "intrus")).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.declineCourier("d1", "intrus")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("le client refuse : retour en recherche et le coursier est exclu", async () => {
      const { service, prisma, gateway } = make();
      prisma.delivery.findUnique.mockResolvedValue(offered());
      await service.declineCourier("d1", "c1");
      const data = prisma.delivery.updateMany.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: "PENDING", courierId: null, declinedCourierIds: ["k1"] });
      expect(gateway.emitToUser).toHaveBeenCalledWith("c1", "delivery:offer-ended", expect.objectContaining({ outcome: "declined" }));
    });

    it("le coursier retire sa proposition", async () => {
      const { service, prisma } = make();
      prisma.delivery.findUnique.mockResolvedValue(offered());
      await service.withdrawOffer("d1", "k1");
      expect(prisma.delivery.updateMany.mock.calls[0][0].data).toMatchObject({ status: "PENDING", courierId: null, declinedCourierIds: ["k1"] });
      await expect(service.withdrawOffer("d1", "autre")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("une proposition expirée est refusée à la validation et retourne en recherche", async () => {
      const { service, prisma } = make();
      prisma.delivery.findUnique.mockResolvedValue(offered({ offerExpiresAt: new Date(Date.now() - 60_000) }));
      await expect(service.approveCourier("d1", "c1")).rejects.toBeInstanceOf(ConflictException);
    });

    it("un coursier occupé par une proposition en attente ne voit plus d'autres missions", async () => {
      const { service, prisma } = make();
      prisma.delivery.findFirst.mockResolvedValue({ id: "d1" });
      await expect(service.pending("k1")).resolves.toEqual([]);
      expect(prisma.delivery.findFirst.mock.calls[0][0].where.OR[0].status.in).toContain("OFFERED");
    });
  });
});
