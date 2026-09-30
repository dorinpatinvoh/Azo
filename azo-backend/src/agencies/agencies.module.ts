import { Body, Controller, Get, Injectable, Module, Post, UseGuards, BadRequestException } from "@nestjs/common";
import { IsEnum, IsString } from "class-validator";
import { AgencyPlan, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";

// Formules du modèle économique : activation unique, comptes max., commission
export const PLANS = {
  PRO:     { fee: 45000,  maxAccounts: 10,   rate: 0.03 },
  ARGENT:  { fee: 100000, maxAccounts: 25,   rate: 0.025 },
  OR:      { fee: 250000, maxAccounts: 100,  rate: 0.02 },
  DIAMANT: { fee: 500000, maxAccounts: 1000, rate: 0.01 },
};

class CreateAgencyDto {
  @IsString() name: string;
  @IsEnum(AgencyPlan) plan: AgencyPlan;
}
class AddDriverDto {
  @IsString() phone: string;
}

@Injectable()
export class AgenciesService {
  constructor(private prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateAgencyDto) {
    const p = PLANS[dto.plan];
    const agency = await this.prisma.agency.create({
      data: { name: dto.name, plan: dto.plan, commissionRate: p.rate, maxAccounts: p.maxAccounts },
    });
    await this.prisma.user.update({ where: { id: ownerId }, data: { role: "AGENCY", agencyId: agency.id } });
    return agency;
  }

  async addDriver(ownerId: string, phone: string) {
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId }, include: { agency: { include: { drivers: true } } } });
    if (!owner?.agency) throw new BadRequestException("Aucune agence liée à ce compte");
    if (owner.agency.drivers.length >= owner.agency.maxAccounts)
      throw new BadRequestException("Capacité de comptes atteinte pour votre formule");
    return this.prisma.user.update({ where: { phone }, data: { role: "DRIVER", agencyId: owner.agency.id } });
  }

  async dashboard(ownerId: string) {
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId }, include: { agency: { include: { drivers: true } } } });
    if (!owner?.agency) throw new BadRequestException("Aucune agence liée à ce compte");
    const driverIds = owner.agency.drivers.map((d) => d.id);
    const rides = await this.prisma.ride.findMany({ where: { driverId: { in: driverIds }, status: "COMPLETED" } });
    return {
      agency: { id: owner.agency.id, name: owner.agency.name, plan: owner.agency.plan },
      drivers: owner.agency.drivers.length,
      completedRides: rides.length,
      netRevenue: rides.reduce((s, r) => s + (r.price - r.commission), 0),
    };
  }
}

@Controller("agencies")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgenciesController {
  constructor(private svc: AgenciesService) {}
  @Post() create(@CurrentUser() u, @Body() dto: CreateAgencyDto) { return this.svc.create(u.userId, dto); }
  @Post("drivers") @Roles(Role.AGENCY) addDriver(@CurrentUser() u, @Body() dto: AddDriverDto) { return this.svc.addDriver(u.userId, dto.phone); }
  @Get("dashboard") @Roles(Role.AGENCY) dashboard(@CurrentUser() u) { return this.svc.dashboard(u.userId); }
}

@Module({ controllers: [AgenciesController], providers: [AgenciesService] })
export class AgenciesModule {}
