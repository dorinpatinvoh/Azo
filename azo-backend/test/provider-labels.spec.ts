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

import { typeLabelOf } from "../src/providers/providers.module";

describe("libellé du type de dossier prestataire", () => {
  // Régression : le libellé d'un Speeder ou d'une agence s'appelait lui-même sans fin (« Internal server error » dans la file admin)
  it("répond pour un Speeder et pour une agence, sans boucle", () => {
    expect(typeLabelOf({ type: "DRIVER" as any })).toEqual(expect.any(String));
    expect(typeLabelOf({ type: "DRIVER" as any }).length).toBeGreaterThan(0);
    expect(typeLabelOf({ type: "AGENCY" as any }).length).toBeGreaterThan(0);
  });

  it("distingue le coursier personnel du livreur express", () => {
    expect(typeLabelOf({ type: "COURIER" as any, categoryId: "COURSIER_PERSONNEL" })).toBe("Coursier personnel");
    expect(typeLabelOf({ type: "COURIER" as any, categoryId: "COURSIER_EXPRESS" })).toBe("Livreur express");
    expect(typeLabelOf({ type: "COURIER" as any, categoryId: null })).toBe("Coursier");
  });
});
