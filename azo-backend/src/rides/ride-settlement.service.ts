import { BadRequestException, Body, Controller, Get, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.module";
import { RidesGateway } from "./rides.gateway";
import { RidesService } from "./rides.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";

const CONFIRMATION_MINUTES = 10;

type SettlementRow = {
  rideId: string;
  dropoffAt: Date;
  confirmationDeadline: Date;
  clientConfirmedAt: Date | null;
  problemReportedAt: Date | null;
  problemReason: string | null;
};

@Injectable()
export class RideSettlementService {
  constructor(private prisma: PrismaService, private rides: RidesService, private notifications: NotificationsService, private gateway: RidesGateway) {}

  private async row(rideId: string): Promise<SettlementRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<SettlementRow[]>(`SELECT "rideId","dropoffAt","confirmationDeadline","clientConfirmedAt","problemReportedAt","problemReason" FROM "RideSettlement" WHERE "rideId"=$1 LIMIT 1`, rideId);
    return rows[0] ?? null;
  }

  async status(rideId: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId }, select: { clientId: true, driverId: true } });
    if (!ride || (ride.clientId !== userId && ride.driverId !== userId)) throw new BadRequestException("Course introuvable");
    const settlement = await this.row(rideId);
    return settlement ? { status: settlement.problemReportedAt ? "DISPUTED" : settlement.clientConfirmedAt ? "COMPLETED" : "DROPPED_OFF_PENDING", confirmationDeadline: settlement.confirmationDeadline, problemReason: settlement.problemReason } : { status: "IN_PROGRESS" };
  }

  async markDroppedOff(rideId: string, driverId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.driverId !== driverId) throw new BadRequestException("Course introuvable ou non attribuée");
    if (ride.status !== "IN_PROGRESS") throw new BadRequestException("La course doit être en cours");
    const deadline = new Date(Date.now() + CONFIRMATION_MINUTES * 60_000);
    const row = await this.prisma.$queryRawUnsafe<SettlementRow[]>(`INSERT INTO "RideSettlement" ("id","rideId","dropoffAt","confirmationDeadline") VALUES (md5(random()::text || clock_timestamp()::text),$1,NOW(),$2) ON CONFLICT ("rideId") DO UPDATE SET "dropoffAt"=NOW(),"confirmationDeadline"=$2,"problemReportedAt"=NULL,"problemReason"=NULL,"clientConfirmedAt"=NULL RETURNING "rideId","dropoffAt","confirmationDeadline","clientConfirmedAt","problemReportedAt","problemReason"`, rideId, deadline);
    await this.notifications.push(ride.clientId, "Confirme ton arrivée", `Le Zem indique t'avoir déposé. Confirme dans ${CONFIRMATION_MINUTES} minutes ou signale un problème.`, "payment");
    this.gateway.emitStatus(rideId, "DROPPED_OFF_PENDING");
    return { rideId, status: "DROPPED_OFF_PENDING", confirmationDeadline: row[0]?.confirmationDeadline };
  }

  async confirm(rideId: string, clientId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.clientId !== clientId) throw new BadRequestException("Course introuvable");
    const settlement = await this.row(rideId);
    if (!settlement) throw new BadRequestException("Le Zem doit d'abord signaler le dépôt");
    if (settlement.problemReportedAt) throw new BadRequestException("Cette course est en litige");
    if (settlement.clientConfirmedAt) return { status: "COMPLETED", alreadyConfirmed: true };
    if (new Date(settlement.confirmationDeadline).getTime() < Date.now()) throw new BadRequestException("Le délai de confirmation est dépassé. La course doit être vérifiée par AZƆ̀.");
    const claimed = await this.prisma.$executeRawUnsafe(`UPDATE "RideSettlement" SET "clientConfirmedAt"=NOW() WHERE "rideId"=$1 AND "clientConfirmedAt" IS NULL AND "problemReportedAt" IS NULL AND "confirmationDeadline">NOW()`, rideId);
    if (claimed !== 1) throw new BadRequestException("Cette confirmation est déjà traitée ou en litige");
    try {
      await this.rides.complete(rideId, ride.driverId!);
    } catch (error) {
      await this.prisma.$executeRawUnsafe(`UPDATE "RideSettlement" SET "clientConfirmedAt"=NULL WHERE "rideId"=$1`, rideId);
      throw error;
    }
    return { status: "COMPLETED", confirmedAt: new Date().toISOString() };
  }

  async reportProblem(rideId: string, clientId: string, reason: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.clientId !== clientId) throw new BadRequestException("Course introuvable");
    const clean = (reason || "Problème signalé par le client").trim().slice(0, 500);
    const result = await this.prisma.$executeRawUnsafe(`UPDATE "RideSettlement" SET "problemReportedAt"=NOW(),"problemReason"=$2 WHERE "rideId"=$1 AND "clientConfirmedAt" IS NULL AND "problemReportedAt" IS NULL`, rideId, clean);
    if (result !== 1) throw new BadRequestException("Aucune confirmation en attente");
    await this.notifications.push(ride.driverId!, "Course en litige", "Le client a signalé un problème. Le paiement est suspendu.", "payment");
    this.gateway.emitStatus(rideId, "DISPUTED");
    return { status: "DISPUTED", message: "Paiement suspendu, vérification AZƆ̀ requise" };
  }
}

@Controller("rides")
@UseGuards(JwtAuthGuard, RolesGuard)
export class RideSettlementController {
  constructor(private settlement: RideSettlementService) {}
  @Get(":id/settlement")
  settlementStatus(@Param("id") id: string, @CurrentUser() user: any) { return this.settlement.status(id, user.userId); }
  @Post(":id/dropoff")
  @Roles(Role.DRIVER)
  dropoff(@Param("id") id: string, @CurrentUser() user: any) { return this.settlement.markDroppedOff(id, user.userId); }
  @Post(":id/confirm-dropoff")
  @Roles(Role.CLIENT)
  confirm(@Param("id") id: string, @CurrentUser() user: any) { return this.settlement.confirm(id, user.userId); }
  @Post(":id/report-problem")
  @Roles(Role.CLIENT)
  report(@Param("id") id: string, @CurrentUser() user: any, @Body() body: { reason?: string }) { return this.settlement.reportProblem(id, user.userId, body?.reason ?? ""); }
}
