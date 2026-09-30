import { Controller, Get, Injectable, Module, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // Indicateurs de l'écran "Tableau de bord administrateur"
  async stats() {
    const [users, rides, completed, agencies] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.ride.count(),
      this.prisma.ride.findMany({ where: { status: "COMPLETED" }, select: { commission: true } }),
      this.prisma.agency.count(),
    ]);
    return {
      users,
      rides,
      completedRides: completed.length,
      commissionsRevenue: completed.reduce((s, r) => s + r.commission, 0),
      agencies,
    };
  }

  users() {
    return this.prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  }
}

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private svc: AdminService) {}
  @Get("stats") stats() { return this.svc.stats(); }
  @Get("users") users() { return this.svc.users(); }
}

@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
