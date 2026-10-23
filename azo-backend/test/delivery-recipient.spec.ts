jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {}, WalletModule: class {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class {}, NotificationsModule: class {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class {}, PricingModule: class {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class {} }));
jest.mock("../src/rides/rides.module", () => ({ RidesModule: class {} }));

import { BadRequestException } from "@nestjs/common";
import { DeliveryService } from "../src/delivery/delivery.module";
import { PricingService } from "../src/pricing/pricing.service";

const pricing = new PricingService();
const order = (over: Record<string, unknown> = {}) => ({
  packageType: "small",
  pickupAddress: "Fidjrossè",
  dropAddress: "Akpakpa",
  payer: "SENDER",
  vehicleType: "ZEM_ESSENCE",
  pickupLat: 6.36,
  pickupLng: 2.38,
  dropLat: 6.37,
  dropLng: 2.43,
  ...over,
});

function make(opts: { recipientUser?: { id: string } | null; sender?: string | null } = {}) {
  const prisma: any = {
    delivery: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "d1", ...data, client: { fullName: opts.sender === undefined ? "Kossi Adjovi" : opts.sender, phone: "+2290196000001" } })),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue(opts.recipientUser === undefined ? null : opts.recipientUser),
      findMany: jest.fn().mockResolvedValue([]),
    },
    providerProfile: { findUnique: jest.fn().mockResolvedValue({ type: "COURIER", status: "APPROVED", categoryId: "COURSIER_EXPRESS", vehicleType: "ZEM_ESSENCE" }) },
  };
  const wallet: any = { getWallet: jest.fn().mockResolvedValue({ balance: 50000 }) };
  const notifications = { push: jest.fn().mockResolvedValue(undefined) };
  const service: any = new DeliveryService(prisma, wallet, notifications as any, pricing, { emitToUser: jest.fn() } as any);
  jest.spyOn(service, "routeKm").mockResolvedValue(3);
  return { service, prisma, notifications };
}

describe("Livraison express : numéro du destinataire et code de remise", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SMS_PROVIDER;
  });

  it("refuse une commande sans numéro de destinataire ou avec un numéro invalide", async () => {
    const { service, prisma } = make();
    for (const recipientPhone of [undefined, "", "123", "0297000042", "abc"]) {
      await expect(service.create("c1", order({ recipientPhone }))).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.delivery.create).not.toHaveBeenCalled();
  });

  it("enregistre le numéro de CETTE commande, au format +229, sans rien reprendre d'une livraison précédente", async () => {
    const { service, prisma } = make();
    await service.create("c1", order({ recipientPhone: "01 97 00 00 42" }));
    expect(prisma.delivery.create.mock.calls[0][0].data.recipientPhone).toBe("+2290197000042");
    await service.create("c1", order({ recipientPhone: "0196000077" }));
    expect(prisma.delivery.create.mock.calls[1][0].data.recipientPhone).toBe("+2290196000077");
  });

  it("le destinataire qui a un compte AZƆ̀ reçoit son code de remise en notification", async () => {
    const { service, notifications } = make({ recipientUser: { id: "u-dest" } });
    const created: any = await service.create("c1", order({ recipientPhone: "0197000042" }));
    expect(notifications.push).toHaveBeenCalledWith(
      "u-dest",
      expect.any(String),
      expect.stringContaining(created.deliveryCode),
      "DELIVERY",
      expect.objectContaining({ titleKey: "NOTIFICATION_DELIVERY_RECIPIENT_CODE", params: expect.objectContaining({ code: created.deliveryCode }) })
    );
  });

  it("sans compte pour ce numéro, ou si c'est l'expéditeur lui-même, aucune notification (l'expéditeur transmet le code)", async () => {
    const none = make({ recipientUser: null });
    await none.service.create("c1", order({ recipientPhone: "0197000042" }));
    expect(none.notifications.push).not.toHaveBeenCalled();
    const self = make({ recipientUser: { id: "c1" } });
    await self.service.create("c1", order({ recipientPhone: "0196000001" }));
    expect(self.notifications.push).not.toHaveBeenCalled();
  });

  it("le coursier ne voit JAMAIS le code de remise, même en simulation, et le numéro du destinataire est masqué", async () => {
    const { service, prisma } = make();
    prisma.delivery.findMany.mockResolvedValue([
      { id: "d1", clientId: "c1", courierId: "k1", status: "IN_PROGRESS", mode: "EXPRESS", price: 1000, pickupCode: "1111", deliveryCode: "2222", recipientPhone: "+2290197000042", client: { fullName: "K", phone: "+2290196000001" } },
    ]);
    const [row]: any[] = await service.courierDeliveries("k1");
    expect(row.deliveryCode).toBe("••••");
    expect(row.recipientPhone).not.toContain("0197000042");
    expect(row.recipientPhone).toContain("••");
    // le code de ramassage reste visible en simulation seulement (le SMS n'est pas encore en service)
    expect(row.pickupCode).toBe("1111");
    process.env.SMS_PROVIDER = "live";
    const [live]: any[] = await service.courierDeliveries("k1");
    expect(live.pickupCode).toBe("••••");
    expect(live.deliveryCode).toBe("••••");
  });

  it("le client, lui, voit ses deux codes et le numéro du destinataire", async () => {
    const { service, prisma } = make();
    prisma.delivery.findMany.mockResolvedValue([
      { id: "d1", clientId: "c1", courierId: "k1", status: "MATCHED", mode: "EXPRESS", price: 1000, pickupCode: "1111", deliveryCode: "2222", recipientPhone: "+2290197000042", client: { fullName: "K", phone: "+2290196000001" } },
    ]);
    const [row]: any[] = await service.list("c1");
    expect(row).toMatchObject({ pickupCode: "1111", deliveryCode: "2222", recipientPhone: "+2290197000042" });
  });
});
