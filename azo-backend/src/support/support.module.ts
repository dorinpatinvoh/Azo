import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { NotificationsModule, NotificationsService } from "../notifications/notifications.module";

export const SUPPORT_CATEGORIES = ["RIDE", "PAYMENT", "ACCOUNT", "SAFETY", "OTHER"] as const;
export const MAX_OPEN_TICKETS = 5;

export class CreateTicketDto {
  @IsIn(SUPPORT_CATEGORIES as unknown as string[]) category: (typeof SUPPORT_CATEGORIES)[number];
  @IsString() @MinLength(3) @MaxLength(120) subject: string;
  @IsString() @MinLength(3) @MaxLength(2000) message: string;
  @IsOptional() @IsString() @MaxLength(64) rideId?: string;
}

export class TicketMessageDto {
  @IsString() @MinLength(1) @MaxLength(2000) text: string;
}

class AdminListQuery {
  @IsOptional() @IsIn(["OPEN", "ANSWERED", "CLOSED"]) status?: "OPEN" | "ANSWERED" | "CLOSED";
}

/**
 * Assistance : le client ou le chauffeur ouvre un ticket (catégorie, sujet, message, course concernée), l'équipe AZƆ̀
 * répond depuis l'espace administrateur, et chaque réponse prévient l'utilisateur par notification.
 */
@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  private async notifyAdmins(title: string, body: string, ticketId: string, titleKey: string, params: Record<string, string>) {
    const admins = await this.prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
    await Promise.all(
      admins.map((a) =>
        this.notifications
          .push(a.id, title, body, "support", { sendPush: true, data: { event: "support-ticket", ticketId }, titleKey, params })
          .catch(() => null)
      )
    );
    return admins.length;
  }

  async create(userId: string, dto: CreateTicketDto) {
    const open = await this.prisma.supportTicket.count({ where: { userId, status: { not: "CLOSED" } } });
    if (open >= MAX_OPEN_TICKETS) {
      throw new BadRequestException(`Tu as déjà ${MAX_OPEN_TICKETS} demandes en cours. Attends une réponse ou complète l'une d'elles.`);
    }
    if (dto.rideId) {
      const ride = await this.prisma.ride.findUnique({ where: { id: dto.rideId }, select: { clientId: true, driverId: true } });
      if (!ride || (ride.clientId !== userId && ride.driverId !== userId)) {
        throw new BadRequestException("Cette course n'est pas liée à ton compte.");
      }
    }
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        category: dto.category,
        subject: dto.subject.trim(),
        rideId: dto.rideId ?? null,
        messages: { create: { authorRole: "USER", authorId: userId, text: dto.message.trim() } },
      },
      include: { messages: true },
    });
    await this.notifyAdmins("Nouvelle demande d'assistance", `${ticket.subject} (${ticket.category})`, ticket.id, "NOTIFICATION_SUPPORT_NEW", {
      subject: ticket.subject,
      category: ticket.category,
    });
    return ticket;
  }

  async listMine(userId: string) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return {
      tickets: tickets.map((t) => ({
        id: t.id, category: t.category, subject: t.subject, status: t.status, rideId: t.rideId,
        createdAt: t.createdAt, updatedAt: t.updatedAt,
        lastMessage: t.messages[0] ? { authorRole: t.messages[0].authorRole, text: t.messages[0].text.slice(0, 140), createdAt: t.messages[0].createdAt } : null,
      })),
    };
  }

  private async load(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        user: { select: { fullName: true, phone: true, role: true } },
      },
    });
    if (!ticket) throw new NotFoundException("Demande introuvable");
    return ticket;
  }

  async getMine(userId: string, id: string) {
    const ticket = await this.load(id);
    if (ticket.userId !== userId) throw new ForbiddenException();
    const { user: _user, ...rest } = ticket;
    return rest;
  }

  async userReply(userId: string, id: string, text: string) {
    const ticket = await this.load(id);
    if (ticket.userId !== userId) throw new ForbiddenException();
    if (ticket.status === "CLOSED") throw new BadRequestException("Cette demande est fermée. Ouvre-en une nouvelle si besoin.");
    const message = await this.prisma.supportMessage.create({ data: { ticketId: id, authorRole: "USER", authorId: userId, text: text.trim() } });
    await this.prisma.supportTicket.update({ where: { id }, data: { status: "OPEN" } });
    await this.notifyAdmins("Réponse d'un utilisateur", ticket.subject, id, "NOTIFICATION_SUPPORT_USER_REPLY", { subject: ticket.subject });
    return message;
  }

  /* ---- Administrateur ---- */

  async adminList(status?: "OPEN" | "ANSWERED" | "CLOSED") {
    const tickets = await this.prisma.supportTicket.findMany({
      where: status ? { status } : {},
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        user: { select: { fullName: true, phone: true, role: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return {
      tickets: tickets.map((t) => ({
        id: t.id, category: t.category, subject: t.subject, status: t.status, rideId: t.rideId, updatedAt: t.updatedAt,
        user: t.user, lastMessage: t.messages[0] ? { authorRole: t.messages[0].authorRole, text: t.messages[0].text.slice(0, 140) } : null,
      })),
    };
  }

  adminGet(id: string) {
    return this.load(id);
  }

  async adminReply(adminId: string, id: string, text: string) {
    const ticket = await this.load(id);
    if (ticket.status === "CLOSED") throw new BadRequestException("Cette demande est fermée.");
    const message = await this.prisma.supportMessage.create({ data: { ticketId: id, authorRole: "ADMIN", authorId: adminId, text: text.trim() } });
    await this.prisma.supportTicket.update({ where: { id }, data: { status: "ANSWERED" } });
    await this.notifications
      .push(ticket.userId, "Réponse du support AZƆ̀", text.trim().slice(0, 120), "support", {
        sendPush: true,
        data: { event: "support-reply", ticketId: id },
        titleKey: "NOTIFICATION_SUPPORT_REPLY",
        params: { text: text.trim().slice(0, 120) },
      })
      .catch(() => null);
    return message;
  }

  async adminClose(adminId: string, id: string) {
    const ticket = await this.load(id);
    if (ticket.status === "CLOSED") return { id, status: "CLOSED" };
    await this.prisma.supportTicket.update({ where: { id }, data: { status: "CLOSED" } });
    await this.notifications
      .push(ticket.userId, "Demande clôturée", `Ta demande « ${ticket.subject} » a été clôturée.`, "support", {
        sendPush: true,
        data: { event: "support-closed", ticketId: id },
        titleKey: "NOTIFICATION_SUPPORT_CLOSED",
        params: { subject: ticket.subject },
      })
      .catch(() => null);
    return { id, status: "CLOSED" };
  }
}

@Controller("support")
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private svc: SupportService) {}

  // POST /support/tickets  { category, subject, message, rideId? }
  @Post("tickets")
  create(@CurrentUser() u, @Body() dto: CreateTicketDto) {
    return this.svc.create(u.userId, dto);
  }

  // GET /support/tickets — mes demandes
  @Get("tickets")
  mine(@CurrentUser() u) {
    return this.svc.listMine(u.userId);
  }

  // GET /support/tickets/:id — une demande et sa conversation
  @Get("tickets/:id")
  one(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.getMine(u.userId, id);
  }

  // POST /support/tickets/:id/messages  { text }
  @Post("tickets/:id/messages")
  reply(@CurrentUser() u, @Param("id") id: string, @Body() dto: TicketMessageDto) {
    return this.svc.userReply(u.userId, id, dto.text);
  }
}

@Controller("admin/support")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminSupportController {
  constructor(private svc: SupportService) {}

  // GET /admin/support/tickets?status=OPEN|ANSWERED|CLOSED
  @Get("tickets")
  @Roles(Role.ADMIN)
  list(@Query() q: AdminListQuery) {
    return this.svc.adminList(q.status);
  }

  @Get("tickets/:id")
  @Roles(Role.ADMIN)
  one(@Param("id") id: string) {
    return this.svc.adminGet(id);
  }

  @Post("tickets/:id/reply")
  @Roles(Role.ADMIN)
  reply(@CurrentUser() u, @Param("id") id: string, @Body() dto: TicketMessageDto) {
    return this.svc.adminReply(u.userId, id, dto.text);
  }

  @Post("tickets/:id/close")
  @Roles(Role.ADMIN)
  close(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.adminClose(u.userId, id);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService],
})
export class SupportModule {}
