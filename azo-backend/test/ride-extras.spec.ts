/** Gains du chauffeur par jour, reçu d'une course terminée et alerte SOS. */
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/notifications/notifications.module", () => ({ NotificationsService: class NotificationsService {} }));

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { RideExtrasService } from "../src/rides/ride-extras.service";

const driverId = "driver-1";
const clientId = "client-1";

function makeService(rides: any[] = [], ride: any = null) {
  const prisma: any = {
    ride: {
      findMany: jest.fn().mockResolvedValue(rides),
      findUnique: jest.fn().mockResolvedValue(ride),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]) },
  };
  const notifications: any = { push: jest.fn().mockResolvedValue({}) };
  return { service: new RideExtrasService(prisma, notifications), prisma, notifications };
}

describe("gains du chauffeur", () => {
  // 13 octobre 2026, 14h UTC = 15h au Bénin
  const now = new Date("2026-10-13T14:00:00Z");

  it("regroupe par jour local, du plus ancien au plus récent, sur 7 jours", async () => {
    const { service } = makeService([
      { price: 1000, finalPrice: 1000, commission: 100, completedAt: new Date("2026-10-13T09:00:00Z") },
      { price: 2000, finalPrice: 1500, commission: 150, completedAt: new Date("2026-10-13T10:00:00Z") },
      { price: 800, finalPrice: null, commission: 80, completedAt: new Date("2026-10-11T08:00:00Z") },
    ]);
    const res = await service.driverEarnings(driverId, "week", now);
    expect(res.days).toHaveLength(7);
    expect(res.days[0].date).toBe("2026-10-07");
    expect(res.days[6]).toMatchObject({ date: "2026-10-13", gross: 2500, net: 2250, rides: 2 });
    expect(res.days.find((d) => d.date === "2026-10-11")).toMatchObject({ gross: 800, net: 720, rides: 1 });
    expect(res.totals).toEqual({ gross: 3300, net: 2970, rides: 3, commission: 330, tips: 0 });
    expect(res.bestDay).toEqual({ date: "2026-10-13", net: 2250 });
    expect(res.averagePerActiveDay).toBe(1485);
  });

  it("les pourboires reçus comptent dans les gains du jour où ils sont donnés, sans commission", async () => {
    const { service, prisma } = makeService([
      { price: 2000, finalPrice: 1500, commission: 150, completedAt: new Date("2026-10-13T10:00:00Z") },
    ]);
    prisma.rideTip = {
      findMany: jest.fn().mockResolvedValue([
        { amount: 500, createdAt: new Date("2026-10-13T11:00:00Z") },
        { amount: 200, createdAt: new Date("2026-10-11T09:00:00Z") },
      ]),
    };
    const res = await service.driverEarnings(driverId, "week", now);
    expect(res.days[6]).toMatchObject({ date: "2026-10-13", gross: 2000, net: 1850, rides: 1, tips: 500 });
    expect(res.days.find((d) => d.date === "2026-10-11")).toMatchObject({ gross: 200, net: 200, rides: 0, tips: 200 });
    expect(res.totals).toEqual({ gross: 2200, net: 2050, rides: 1, commission: 150, tips: 700 });
    expect(res.bestDay).toEqual({ date: "2026-10-13", net: 1850 });
  });

  it("une course terminée à 23h30 UTC compte pour le lendemain (heure du Bénin, UTC+1)", async () => {
    const { service } = makeService([
      { price: 1000, finalPrice: 1000, commission: 0, completedAt: new Date("2026-10-12T23:30:00Z") },
    ]);
    const res = await service.driverEarnings(driverId, "week", now);
    expect(res.days.find((d) => d.date === "2026-10-13")).toMatchObject({ net: 1000, rides: 1 });
    expect(res.days.find((d) => d.date === "2026-10-12")).toMatchObject({ rides: 0 });
  });

  it("couvre 1 jour (aujourd'hui) ou 30 jours selon la période, sans course = zéros", async () => {
    const { service } = makeService([]);
    expect((await service.driverEarnings(driverId, "day", now)).days).toHaveLength(1);
    const month = await service.driverEarnings(driverId, "month", now);
    expect(month.days).toHaveLength(30);
    expect(month.totals).toEqual({ gross: 0, net: 0, rides: 0, commission: 0, tips: 0 });
    expect(month.bestDay).toBeNull();
    expect(month.averagePerActiveDay).toBe(0);
  });
});

describe("reçu de course", () => {
  const completed = {
    id: "abcdef12-0000-0000-0000-000000000000", clientId, driverId, status: "COMPLETED", vehicleType: "ZEM_ESSENCE",
    price: 1200, finalPrice: 1000, commission: 100, priceMode: "PARTIAL", traveledMeters: 1520, settledDistanceMeters: 900,
    originLabel: "Cadjèhoun", destLabel: "Dantokpa", completedAt: new Date("2026-10-13T10:00:00Z"), createdAt: new Date(),
    client: { firstName: "Kossi", lastName: "Adjovi", fullName: "Kossi Adjovi" },
    driver: { firstName: "Romaric", lastName: "Soglo", fullName: "Romaric Soglo", provider: { fullName: "Romaric Soglo", vehicleModel: "Bajaj", plateNumber: "RB-1-AX" } },
  };

  it("le client voit le montant payé, pas la commission", async () => {
    const { service } = makeService([], completed);
    const r: any = await service.receipt(completed.id, clientId);
    expect(r).toMatchObject({ reference: "AZO-ABCDEF12", amount: 1000, distanceKm: 0.9, priceMode: "PARTIAL", currency: "FCFA" });
    expect(r).not.toHaveProperty("commission");
    expect(r).not.toHaveProperty("net");
  });

  it("le chauffeur voit sa commission et son gain net", async () => {
    const { service } = makeService([], completed);
    expect(await service.receipt(completed.id, driverId)).toMatchObject({ commission: 100, net: 900 });
  });

  it("refuse un tiers, et une course non terminée", async () => {
    await expect(makeService([], completed).service.receipt(completed.id, "intrus")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(makeService([], { ...completed, status: "IN_PROGRESS" }).service.receipt(completed.id, clientId)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});

describe("alerte SOS", () => {
  const active = { id: "abcdef12-0000", clientId, driverId, status: "IN_PROGRESS" };

  it("prévient les administrateurs et l'autre participant, avec la position", async () => {
    const { service, notifications } = makeService([], active);
    const res = await service.sos(active.id, clientId, { lat: 6.37, lng: 2.39 });
    expect(res).toEqual({ sent: true, notifiedAdmins: 2 });
    const recipients = notifications.push.mock.calls.map((c: any[]) => c[0]);
    expect(recipients).toEqual(expect.arrayContaining(["admin-1", "admin-2", driverId]));
    expect(recipients).not.toContain(clientId);
    const adminCall = notifications.push.mock.calls.find((c: any[]) => c[0] === "admin-1");
    expect(adminCall[2]).toContain("https://maps.google.com/?q=6.37,2.39");
    expect(adminCall[4]).toMatchObject({ sendPush: true, data: { event: "sos", by: "CLIENT", lat: 6.37, lng: 2.39 } });
  });

  it("fonctionne sans position (GPS indisponible)", async () => {
    const { service, notifications } = makeService([], active);
    await service.sos(active.id, driverId);
    const adminCall = notifications.push.mock.calls.find((c: any[]) => c[0] === "admin-1");
    expect(adminCall[2]).not.toContain("maps.google.com");
    expect(adminCall[4].data.by).toBe("DRIVER");
  });

  it("refuse un tiers et une course qui n'est pas en cours", async () => {
    await expect(makeService([], active).service.sos(active.id, "intrus")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(makeService([], { ...active, status: "COMPLETED" }).service.sos(active.id, clientId)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
