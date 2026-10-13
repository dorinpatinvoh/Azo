/** Assistance : tickets, réponses de l'équipe, notifications. */
jest.mock("@prisma/client", () => ({ Role: { ADMIN: "ADMIN", CLIENT: "CLIENT", DRIVER: "DRIVER" } }));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/common/guards/jwt-auth.guard", () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock("../src/common/guards/roles.guard", () => ({ RolesGuard: class RolesGuard {} }));
jest.mock("../src/notifications/notifications.module", () => ({
  NotificationsModule: class NotificationsModule {},
  NotificationsService: class NotificationsService {},
}));

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { MAX_OPEN_TICKETS, SupportService } from "../src/support/support.module";

function makeService(opts: { openTickets?: number; ride?: any; ticket?: any } = {}) {
  const ticket = opts.ticket ?? {
    id: "t1", userId: "u1", category: "PAYMENT", subject: "Recharge non créditée", status: "OPEN", rideId: null,
    messages: [{ authorRole: "USER", text: "Bonjour" }], user: { fullName: "Kossi", phone: "+2290197000001", role: "CLIENT" },
  };
  const prisma: any = {
    supportTicket: {
      count: jest.fn().mockResolvedValue(opts.openTickets ?? 0),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "t-new", ...data, messages: [{ text: data.messages.create.text }] })),
      findUnique: jest.fn().mockResolvedValue(ticket),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    supportMessage: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "m1", ...data })) },
    ride: { findUnique: jest.fn().mockResolvedValue(opts.ride ?? null) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: "admin-1" }]) },
  };
  const notifications: any = { push: jest.fn().mockResolvedValue({}) };
  return { service: new SupportService(prisma, notifications), prisma, notifications };
}

const dto = { category: "PAYMENT" as const, subject: "Recharge non créditée", message: "J'ai payé 500 F mais rien n'arrive." };

describe("ouverture d'une demande", () => {
  it("crée la demande avec son premier message et prévient les administrateurs", async () => {
    const { service, prisma, notifications } = makeService();
    const ticket: any = await service.create("u1", dto);
    expect(prisma.supportTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u1", category: "PAYMENT", messages: { create: expect.objectContaining({ authorRole: "USER" }) } }) })
    );
    expect(ticket.id).toBe("t-new");
    expect(notifications.push).toHaveBeenCalledWith("admin-1", expect.any(String), expect.any(String), "support", expect.objectContaining({ sendPush: true }));
  });

  it(`limite à ${MAX_OPEN_TICKETS} demandes en cours`, async () => {
    const { service } = makeService({ openTickets: MAX_OPEN_TICKETS });
    await expect(service.create("u1", dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuse une course qui n'est pas celle de l'utilisateur", async () => {
    const { service } = makeService({ ride: { clientId: "autre", driverId: "autre2" } });
    await expect(service.create("u1", { ...dto, rideId: "r1" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepte la course dont l'utilisateur est le chauffeur", async () => {
    const { service } = makeService({ ride: { clientId: "c", driverId: "u1" } });
    await expect(service.create("u1", { ...dto, rideId: "r1" })).resolves.toBeTruthy();
  });
});

describe("conversation", () => {
  it("un utilisateur ne lit pas la demande d'un autre", async () => {
    await expect(makeService().service.getMine("intrus", "t1")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("la réponse de l'équipe passe la demande à ANSWERED et prévient l'utilisateur", async () => {
    const { service, prisma, notifications } = makeService();
    await service.adminReply("admin-1", "t1", "Nous vérifions votre paiement.");
    expect(prisma.supportMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ authorRole: "ADMIN", ticketId: "t1" }) });
    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { status: "ANSWERED" } });
    expect(notifications.push).toHaveBeenCalledWith("u1", expect.any(String), expect.stringContaining("Nous vérifions"), "support", expect.anything());
  });

  it("la réponse de l'utilisateur rouvre la demande ; impossible sur une demande fermée", async () => {
    const open = makeService();
    await open.service.userReply("u1", "t1", "Merci");
    expect(open.prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { status: "OPEN" } });

    const closed = makeService({ ticket: { id: "t1", userId: "u1", subject: "x", status: "CLOSED", messages: [], user: {} } });
    await expect(closed.service.userReply("u1", "t1", "Encore")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("la clôture prévient l'utilisateur", async () => {
    const { service, prisma, notifications } = makeService();
    await expect(service.adminClose("admin-1", "t1")).resolves.toEqual({ id: "t1", status: "CLOSED" });
    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { status: "CLOSED" } });
    expect(notifications.push).toHaveBeenCalledWith("u1", expect.any(String), expect.any(String), "support", expect.anything());
  });
});
