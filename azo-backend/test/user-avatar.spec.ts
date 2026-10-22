import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

jest.mock("@prisma/client", () => ({
  Gender: { M: "M", F: "F" },
  Role: { CLIENT: "CLIENT", DRIVER: "DRIVER", AGENCY: "AGENCY", ADMIN: "ADMIN", ARTISAN: "ARTISAN" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));

import { UpdateAvatarDto, UsersService } from "../src/users/users.module";

const PIXEL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD";

function make(opts: { saved?: { dataUri: string; updatedAt: Date } | null; dossierPhoto?: { url: string; uploadedAt: Date } | null } = {}) {
  const prisma: any = {
    userAvatar: {
      findUnique: jest.fn().mockResolvedValue(opts.saved ?? null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    providerDocument: { findFirst: jest.fn().mockResolvedValue(opts.dossierPhoto ?? null) },
  };
  return { service: new UsersService(prisma, {} as any, {} as any), prisma };
}

describe("photo de profil gardée sur le serveur", () => {
  it("renvoie la photo choisie par l'utilisateur", async () => {
    const { service } = make({ saved: { dataUri: PIXEL, updatedAt: new Date() } });
    await expect(service.getAvatar("u1")).resolves.toMatchObject({ dataUri: PIXEL, source: "USER" });
  });

  it("à défaut, un prestataire retrouve la photo de profil de son dossier", async () => {
    const { service, prisma } = make({ dossierPhoto: { url: PIXEL + "DOSSIER", uploadedAt: new Date() } });
    await expect(service.getAvatar("u1")).resolves.toMatchObject({ dataUri: PIXEL + "DOSSIER", source: "DOSSIER" });
    expect(prisma.providerDocument.findFirst.mock.calls[0][0].where).toMatchObject({ kind: "PROFILE_PHOTO", provider: { userId: "u1" } });
  });

  it("sans aucune photo : null", async () => {
    const { service } = make();
    await expect(service.getAvatar("u1")).resolves.toMatchObject({ dataUri: null, source: null });
  });

  it("enregistre (une seule ligne par compte) puis retire la photo choisie", async () => {
    const { service, prisma } = make();
    await service.setAvatar("u1", PIXEL);
    expect(prisma.userAvatar.upsert).toHaveBeenCalledWith({ where: { userId: "u1" }, create: { userId: "u1", dataUri: PIXEL }, update: { dataUri: PIXEL } });
    await service.removeAvatar("u1");
    expect(prisma.userAvatar.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("n'accepte que des images JPEG, PNG ou WEBP de 2 Mo au plus", async () => {
    const check = async (dataUri: string) => (await validate(plainToInstance(UpdateAvatarDto, { dataUri }))).length;
    expect(await check(PIXEL)).toBe(0);
    expect(await check("data:image/png;base64,AAAA")).toBe(0);
    expect(await check("data:image/webp;base64,AAAA")).toBe(0);
    expect(await check("http://exemple.com/photo.jpg")).toBeGreaterThan(0);
    expect(await check("data:image/gif;base64,AAAA")).toBeGreaterThan(0);
    expect(await check("data:text/html;base64,AAAA")).toBeGreaterThan(0);
    expect(await check("data:image/jpeg;base64," + "A".repeat(2_800_100))).toBeGreaterThan(0);
  });
});
