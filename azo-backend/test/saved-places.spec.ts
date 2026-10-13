/** Adresses enregistrées et suggestions de destination d'après l'historique. */
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/common/guards/jwt-auth.guard", () => ({ JwtAuthGuard: class JwtAuthGuard {} }));

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MAX_OTHER_PLACES, SavedPlacesService } from "../src/places/saved-places.module";

const userId = "u1";
const place = { title: "Maison", address: "Cadjèhoun", latitude: 6.36, longitude: 2.39 };

function makeService(rides: any[] = []) {
  const rows: any[] = [];
  let seq = 0;
  const prisma: any = {
    savedPlace: {
      findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(rows.filter((r) => r.userId === where.userId))),
      findFirst: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(rows.find((r) => r.userId === where.userId && (!where.kind || r.kind === where.kind) && (!where.id || r.id === where.id)) ?? null)
      ),
      count: jest.fn().mockImplementation(({ where }) => Promise.resolve(rows.filter((r) => r.userId === where.userId && r.kind === where.kind).length)),
      create: jest.fn().mockImplementation(({ data }) => {
        const row = { id: "p" + ++seq, ...data };
        rows.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      delete: jest.fn().mockImplementation(({ where }) => {
        rows.splice(rows.findIndex((r) => r.id === where.id), 1);
        return Promise.resolve({});
      }),
    },
    ride: { findMany: jest.fn().mockResolvedValue(rides) },
  };
  return { service: new SavedPlacesService(prisma), rows };
}

describe("adresses enregistrées", () => {
  it("Domicile : créé puis remplacé, jamais en double", async () => {
    const { service, rows } = makeService();
    const first = await service.setFixed(userId, "HOME", place);
    const second = await service.setFixed(userId, "HOME", { ...place, title: "Nouveau domicile", latitude: 6.4 });
    expect(second.id).toBe(first.id);
    expect(rows.filter((r) => r.kind === "HOME")).toHaveLength(1);
    expect(second).toMatchObject({ kind: "HOME", title: "Nouveau domicile", latitude: 6.4 });
  });

  it("refuse un type inconnu", async () => {
    await expect(makeService().service.setFixed(userId, "GYM", place)).rejects.toBeInstanceOf(BadRequestException);
  });

  it(`les autres adresses sont limitées à ${MAX_OTHER_PLACES}`, async () => {
    const { service } = makeService();
    for (let i = 0; i < MAX_OTHER_PLACES; i++) await service.addOther(userId, { ...place, title: "Lieu " + i });
    await expect(service.addOther(userId, place)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("supprime une adresse du client, et refuse celle d'un autre", async () => {
    const { service } = makeService();
    const added = await service.addOther(userId, place);
    await expect(service.remove("autre", added.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(userId, added.id)).resolves.toEqual({ removed: added.id });
    expect((await service.list(userId)).places).toHaveLength(0);
  });
});

describe("suggestions de destination", () => {
  const at = (days: number) => new Date(Date.now() - days * 86_400_000);
  const ride = (label: string, lat: number, lng: number, days: number) => ({ destLabel: label, destLat: lat, destLng: lng, createdAt: at(days) });

  it("classe par fréquence puis récence, regroupe les libellés identiques", async () => {
    const { service } = makeService([
      ride("Marché Dantokpa", 6.3728, 2.4339, 1),
      ride("Aéroport", 6.3572, 2.3844, 2),
      ride("marché dantokpa", 6.3728, 2.4339, 5),
      ride("Aéroport", 6.3572, 2.3844, 9),
      ride("Étoile Rouge", 6.3725, 2.4061, 0),
    ]);
    const { suggestions } = await service.suggestions(userId);
    expect(suggestions.map((s) => s.title)).toEqual(["Marché Dantokpa", "Aéroport", "Étoile Rouge"]);
    expect(suggestions[0].rides).toBe(2);
  });

  it("n'offre pas ce qui est déjà enregistré (même nom, ou à moins de 100 m)", async () => {
    const { service } = makeService([ride("Maison", 6.36, 2.39, 1), ride("Chez moi bis", 6.36005, 2.39005, 1), ride("Dantokpa", 6.3728, 2.4339, 2)]);
    await service.setFixed(userId, "HOME", place);
    const { suggestions } = await service.suggestions(userId);
    expect(suggestions.map((s) => s.title)).toEqual(["Dantokpa"]);
  });

  it("renvoie une liste vide sans historique", async () => {
    expect((await makeService([]).service.suggestions(userId)).suggestions).toEqual([]);
  });
});
