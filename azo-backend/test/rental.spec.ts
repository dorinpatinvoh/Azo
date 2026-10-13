/** Location : catalogue en base, prix toujours calculé côté serveur. */
jest.mock("@prisma/client", () => ({ Role: { ADMIN: "ADMIN" } }));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/common/guards/jwt-auth.guard", () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock("../src/common/guards/roles.guard", () => ({ RolesGuard: class RolesGuard {} }));
jest.mock("../src/common/guards/registration-complete.guard", () => ({ RegistrationCompleteGuard: class RegistrationCompleteGuard {} }));

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { RentalService, rentalPrice, vehicleFormulas } from "../src/rental/rental.module";

const corolla = { id: "corolla", name: "Toyota Corolla Prestige", seats: 4, pricePerDay: 28000, price4h: 12000, priceWeek: 150000, active: true };
const basic = { ...corolla, id: "tucson", name: "Hyundai Tucson", pricePerDay: 35000, price4h: null, priceWeek: null };

describe("prix de location", () => {
  it("4 heures, jour(s) et semaine", () => {
    expect(rentalPrice(corolla, "4h")).toBe(12000);
    expect(rentalPrice(corolla, "day")).toBe(28000);
    expect(rentalPrice(corolla, "day", 3)).toBe(84000);
    expect(rentalPrice(corolla, "week")).toBe(150000);
  });

  it("une formule sans prix n'est pas proposée", () => {
    expect(() => rentalPrice(basic, "4h")).toThrow(BadRequestException);
    expect(() => rentalPrice(basic, "week")).toThrow(BadRequestException);
    expect(vehicleFormulas(basic)).toEqual([{ id: "day", price: 35000 }]);
    expect(vehicleFormulas(corolla).map((f) => f.id)).toEqual(["4h", "day", "week"]);
  });
});

describe("réservation", () => {
  function makeService(vehicle: any) {
    const prisma: any = {
      rentalVehicle: { findUnique: jest.fn().mockResolvedValue(vehicle), findMany: jest.fn().mockResolvedValue(vehicle ? [vehicle] : []) },
      rentalBooking: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "b1", ...data })) },
    };
    return { service: new RentalService(prisma), prisma };
  }

  it("le prix enregistré vient du serveur, pas du client", async () => {
    const { service, prisma } = makeService(corolla);
    // un client malveillant peut ajouter un prix : il est ignoré (le DTO ne le lit pas)
    const booking: any = await service.book("c1", { vehicleId: "corolla", formula: "day", days: 2, pricePerDay: 1 } as any);
    expect(booking).toMatchObject({ vehicleId: "corolla", vehicleModel: "Toyota Corolla Prestige", totalPrice: 56000, pricePerDay: 28000 });
    expect(prisma.rentalBooking.create).toHaveBeenCalledTimes(1);
  });

  it("refuse un véhicule inconnu, désactivé, ou une formule non proposée", async () => {
    await expect(makeService(null).service.book("c1", { vehicleId: "x", formula: "day" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(makeService({ ...corolla, active: false }).service.book("c1", { vehicleId: "corolla", formula: "day" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(makeService(basic).service.book("c1", { vehicleId: "tucson", formula: "week" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("le catalogue liste les formules disponibles de chaque véhicule", async () => {
    const [v] = await makeService(corolla).service.catalog();
    expect(v.formulas.map((f: any) => f.id)).toEqual(["4h", "day", "week"]);
  });
});
