import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";

jest.mock("@prisma/client", () => ({
  AgencyPlan: {},
  DocumentKind: {},
  ProviderStatus: {},
  ProviderType: {},
  ProviderEventType: {},
  Role: { CLIENT: "CLIENT", DRIVER: "DRIVER", AGENCY: "AGENCY", ADMIN: "ADMIN" },
  VehicleType: {},
  DocumentStatus: {},
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/notifications/notifications.module", () => ({
  NotificationsModule: class NotificationsModule {},
  NotificationsService: class NotificationsService {},
}));

import { ProvidersService } from "../src/providers/providers.module";

function service(prisma: any) {
  return new ProvidersService(prisma, {} as any);
}

describe("inscription professionnelle : agence réservée à l'inscription, suppression d'un brouillon", () => {
  it("refuse un dossier d'agence à un client qui ne s'est pas inscrit comme agence", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "u1", status: "ACTIVE", provider: null, signupKind: "CLIENT" }) },
      providerProfile: { create: jest.fn() },
    };
    await expect(service(prisma).saveApplication("u1", { type: "AGENCY" } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.providerProfile.create).not.toHaveBeenCalled();
  });

  it("refuse un dossier d'agence à un ancien compte sans type d'inscription", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "u1", status: "ACTIVE", provider: null, signupKind: null }) },
      providerProfile: { create: jest.fn() },
    };
    await expect(service(prisma).saveApplication("u1", { type: "AGENCY" } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("supprime un brouillon du propriétaire", async () => {
    const prisma = {
      providerProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: "p1", userId: "u1", status: "DRAFT", documents: [{ url: "data:image/jpeg;base64,xx" }] }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    await expect(service(prisma).deleteDraft("u1", "p1")).resolves.toEqual({ deleted: "p1" });
    expect(prisma.providerProfile.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("refuse de supprimer un dossier déjà déposé", async () => {
    const prisma = {
      providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: "p1", userId: "u1", status: "SUBMITTED", documents: [] }), delete: jest.fn() },
    };
    await expect(service(prisma).deleteDraft("u1", "p1")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.providerProfile.delete).not.toHaveBeenCalled();
  });

  it("refuse de supprimer le dossier d'un autre utilisateur", async () => {
    const prisma = {
      providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: "p1", userId: "autre", status: "DRAFT", documents: [] }), delete: jest.fn() },
    };
    await expect(service(prisma).deleteDraft("u1", "p1")).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.providerProfile.delete).not.toHaveBeenCalled();
  });
});
