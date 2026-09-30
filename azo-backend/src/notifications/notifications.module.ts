import { Controller, Get, Injectable, Module, Param, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  // À appeler depuis les autres services (course acceptée, paiement reçu...)
  push(userId: string, title: string, body: string, type: string) {
    return this.prisma.notification.create({ data: { userId, title, body, type } });
    // TODO : envoyer aussi une notification push Firebase (FCM) au téléphone
  }

  list(userId: string) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  }
}

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private svc: NotificationsService) {}
  @Get() list(@CurrentUser() u) { return this.svc.list(u.userId); }
  @Post("read-all") readAll(@CurrentUser() u) { return this.svc.markAllRead(u.userId); }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
