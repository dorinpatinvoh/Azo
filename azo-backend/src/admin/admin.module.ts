import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { Role, UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";

class UpdateUserStatusDto {
  @IsIn(["ACTIVE", "BLOCKED"])
  status: UserStatus;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // Indicateurs globaux de l'écran "Tableau de bord administrateur"
  async stats() {
    const [
      users,
      rides,
      completedRides,
      deliveries,
      completedDeliveries,
      agencies,
      providersPending,
      providersApproved,
      blockedUsers,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.ride.count(),
      this.prisma.ride.findMany({ where: { status: "COMPLETED" }, select: { commission: true, price: true } }),
      this.prisma.delivery.count(),
      this.prisma.delivery.findMany({ where: { status: "COMPLETED" }, select: { price: true } }),
      this.prisma.agency.count(),
      this.prisma.providerProfile.count({
        where: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "NEED_INFO"] } },
      }),
      this.prisma.providerProfile.count({ where: { status: "APPROVED" } }),
      this.prisma.user.count({ where: { status: "BLOCKED" } }),
    ]);

    const rideCommissions = completedRides.reduce((s, r) => s + r.commission, 0);
    const deliveryCommissions = completedDeliveries.reduce((s, d) => s + Math.round(d.price * 0.15), 0);

    return {
      users,
      rides,
      completedRides: completedRides.length,
      deliveries,
      completedDeliveries: completedDeliveries.length,
      commissionsRevenue: rideCommissions + deliveryCommissions,
      agencies,
      providersPending,
      providersApproved,
      blockedUsers,
    };
  }

  async users(q?: string, role?: string) {
    const search = q?.trim();
    return this.prisma.user.findMany({
      where: {
        ...(role && Object.values(Role).includes(role as Role) ? { role: role as Role } : {}),
        ...(search
          ? {
              OR: [
                { phone: { contains: search, mode: "insensitive" } },
                { fullName: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        wallet: { select: { balance: true } },
        provider: { select: { id: true, type: true, status: true, kycScore: true } },
        agency: { select: { id: true, name: true, plan: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async setUserStatus(adminId: string, userId: string, dto: UpdateUserStatusDto) {
    if (adminId === userId && dto.status === "BLOCKED") {
      throw new BadRequestException("Tu ne peux pas bloquer ton propre compte administrateur");
    }
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { provider: true },
    });
    if (!target) throw new NotFoundException("Utilisateur introuvable");

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: dto.status },
      include: {
        wallet: { select: { balance: true } },
        provider: { select: { id: true, type: true, status: true, kycScore: true } },
        agency: { select: { id: true, name: true, plan: true } },
      },
    });

    if (target.provider) {
      await this.prisma.providerEvent.create({
        data: {
          providerId: target.provider.id,
          actorId: adminId,
          type: dto.status === "BLOCKED" ? "SUSPENDED" : "REINSTATED",
          comment:
            dto.status === "BLOCKED"
              ? `Compte bloqué depuis la gestion utilisateurs${dto.reason ? ` : ${dto.reason}` : ""}`
              : "Compte débloqué depuis la gestion utilisateurs",
        },
      });
    }

    return updated;
  }

  async auditLog() {
    const events = await this.prisma.providerEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      include: {
        provider: {
          select: {
            id: true,
            type: true,
            fullName: true,
            agencyName: true,
            user: { select: { phone: true } },
          },
        },
      },
    });
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      comment: e.comment,
      actorId: e.actorId,
      createdAt: e.createdAt,
      provider: {
        id: e.provider.id,
        type: e.provider.type,
        name: e.provider.fullName ?? e.provider.agencyName ?? e.provider.user.phone,
        phone: e.provider.user.phone,
      },
    }));
  }
}

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private svc: AdminService) {}

  @Get("stats")
  stats() {
    return this.svc.stats();
  }

  @Get("users")
  users(@Query("q") q?: string, @Query("role") role?: string) {
    return this.svc.users(q, role);
  }

  @Post("users/:id/status")
  setUserStatus(@CurrentUser() u, @Param("id") id: string, @Body() dto: UpdateUserStatusDto) {
    return this.svc.setUserStatus(u.userId, id, dto);
  }

  @Get("audit-log")
  auditLog() {
    return this.svc.auditLog();
  }
}

@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
