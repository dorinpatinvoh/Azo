import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";
import { Role, UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WalletModule, WalletService } from "../wallet/wallet.module";
import { PricingModule, PricingService } from "../pricing/pricing.module";
import { UsersModule } from "../users/users.module";
import { NpiCryptoService } from "../common/npi-crypto.service";
import { FinanceService, MIN_COMPANY_WITHDRAWAL } from "./finance.service";
import { deleteClientAccount } from "./client-deletion";

class ProviderWithdrawalPaidDto {
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

class ProviderWithdrawalRejectDto {
  @IsString() @MinLength(5) @MaxLength(200) reason: string;
}

class MonthlySettlementDto {
  /** Mois à prélever, format AAAA-MM (par défaut : mois en cours). */
  @IsOptional()
  @IsString()
  @MaxLength(7)
  period?: string;
}

class WithdrawalDto {
  @IsInt({ message: "Le montant doit être un nombre entier de FCFA" })
  @Min(MIN_COMPANY_WITHDRAWAL, { message: `Le retrait minimum est de ${MIN_COMPANY_WITHDRAWAL} FCFA` })
  amount: number;

  /** Compte Mobile Money qui reçoit l'argent (10 chiffres, 01…). */
  @IsString()
  @MaxLength(20)
  phone: string;

  @IsOptional()
  @IsIn(["MTN", "MOOV", "CELTIIS"])
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

class MarkPaidDto {
  /** Référence de l'opération Mobile Money. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;
}

class UpdateUserNameDto {
  @IsString() @MinLength(2) @MaxLength(80) firstName: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
}

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
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private pricing: PricingService,
    private npiCrypto: NpiCryptoService
  ) {}

  // Prélèvement mensuel des Spider indépendants (15 % des revenus du mois), délégué au
  // portefeuille pour rester idempotent et auditable.
  chargeZemMonthly(period?: string) {
    return this.wallet.chargeMonthlyIndependentZem(period);
  }

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
      this.prisma.user.count({ where: { NOT: { phone: { startsWith: "supprime-" } } } }),
      this.prisma.ride.count(),
      this.prisma.ride.findMany({ where: { status: "COMPLETED" }, select: { commission: true, price: true } }),
      this.prisma.delivery.count(),
      this.prisma.delivery.findMany({ where: { status: "COMPLETED" }, select: { price: true } }),
      this.prisma.agency.count(),
      this.prisma.providerProfile.count({
        where: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "NEED_INFO"] } },
      }),
      this.prisma.providerProfile.count({ where: { status: "APPROVED" } }),
      this.prisma.user.count({ where: { status: "BLOCKED", NOT: { phone: { startsWith: "supprime-" } } } }),
    ]);

    // Activité récente : jours calendaires à l'heure du Bénin (UTC+1)
    const DAY = 86400000;
    const beninNow = Date.now() + 3600000;
    const startOfBeninToday = Math.floor(beninNow / DAY) * DAY - 3600000;
    const since = new Date(startOfBeninToday - 6 * DAY);
    const open = ["PENDING", "OFFERED", "MATCHED", "ARRIVED", "IN_PROGRESS"] as any[];
    const real = { NOT: { phone: { startsWith: "supprime-" } } };
    const [clients, newUsers7d, recentRides, recentDeliveries, openRides, openDeliveries, withdrawalsPending, ratingAgg] = await Promise.all([
      this.prisma.user.count({ where: { role: "CLIENT", provider: null, ...real } }),
      this.prisma.user.count({ where: { createdAt: { gte: since }, ...real } }),
      this.prisma.ride.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, status: true, price: true } }),
      this.prisma.delivery.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, status: true, price: true } }),
      this.prisma.ride.count({ where: { status: { in: open } } }),
      this.prisma.delivery.count({ where: { status: { in: open } } }),
      this.prisma.transaction.aggregate({ where: { labelKey: "TRANSACTION_WITHDRAWAL", status: "PENDING" }, _count: true, _sum: { amount: true } }),
      this.prisma.ride.aggregate({ where: { rating: { not: null } }, _avg: { rating: true }, _count: { rating: true } }),
    ]);
    const week = Array.from({ length: 7 }, (_, i) => {
      const from = startOfBeninToday - (6 - i) * DAY;
      const inDay = (d: Date) => d.getTime() >= from && d.getTime() < from + DAY;
      const rs = recentRides.filter((r) => inDay(r.createdAt));
      const ds = recentDeliveries.filter((r) => inDay(r.createdAt));
      return {
        day: new Date(from + 3600000).toISOString().slice(0, 10),
        rides: rs.length,
        deliveries: ds.length,
        volume: [...rs, ...ds].filter((x) => x.status === "COMPLETED").reduce((a, x) => a + x.price, 0),
      };
    });
    const today = week[6];

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
      clients,
      newUsers7d,
      today: { rides: today.rides, deliveries: today.deliveries, volume: today.volume },
      inProgress: openRides + openDeliveries,
      volumeTotal: completedRides.reduce((a, r) => a + r.price, 0) + completedDeliveries.reduce((a, d) => a + d.price, 0),
      week,
      providerWithdrawalsPending: { count: withdrawalsPending._count, amount: withdrawalsPending._sum.amount ?? 0 },
      averageRating: ratingAgg._count.rating > 0 ? Math.round((ratingAgg._avg.rating ?? 0) * 10) / 10 : null,
    };
  }

  async users(q?: string, role?: string) {
    const search = q?.trim();
    return this.prisma.user.findMany({
      where: {
        // Les comptes déjà supprimés (anonymisés, numéro « supprime-… ») ne sont plus listés
        NOT: { phone: { startsWith: "supprime-" } },
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
      select: {
        id: true,
        phone: true,
        fullName: true,
        role: true,
        status: true,
        createdAt: true,
        wallet: { select: { balance: true } },
        provider: { select: { id: true, type: true, status: true, kycScore: true } },
        agency: { select: { id: true, name: true, plan: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /** Remet les notes d'un utilisateur à zéro : les avis antérieurs sont ignorés (lève une restriction de notation). */
  async resetRatings(adminId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException("Utilisateur introuvable");
    const at = new Date();
    await this.prisma.user.update({ where: { id: userId }, data: { ratingResetAt: at } });
    return { userId, ratingResetAt: at.toISOString(), by: adminId };
  }

  /** Corrige le nom d'une personne (compte, et dossier prestataire s'il existe). Chaque changement est noté au journal du compte. */
  async renameUser(adminId: string, userId: string, dto: UpdateUserNameDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, phone: true, provider: { select: { id: true } } } });
    if (!user || user.phone.startsWith("supprime-")) throw new NotFoundException("Utilisateur introuvable");
    const firstName = dto.firstName.trim().replace(/\s+/g, " ");
    const lastName = (dto.lastName ?? "").trim().replace(/\s+/g, " ");
    if (firstName.length < 2) throw new BadRequestException("Le prénom est trop court");
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { firstName, lastName: lastName || null, fullName } }),
      ...(user.provider ? [this.prisma.providerProfile.update({ where: { id: user.provider.id }, data: { fullName } })] : []),
      this.prisma.userProfileChange.create({ data: { userId, field: "fullName (administrateur)", oldValue: user.fullName, newValue: fullName } }),
    ]);
    return { userId, fullName, by: adminId };
  }

  /** Remet le portefeuille d'un client ou d'un prestataire à zéro par une écriture visible dans son historique (jamais en silence). */
  async resetWallet(adminId: string, userId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } });
    if (!user || user.phone.startsWith("supprime-")) throw new NotFoundException("Utilisateur introuvable");
    if (user.role === "ADMIN" || user.role === "AGENCY") throw new BadRequestException("Le portefeuille d'un administrateur ou d'une agence ne se remet pas à zéro ici");
    if (!user.wallet) throw new BadRequestException("Ce compte n'a pas de portefeuille");
    const before = user.wallet.balance;
    if (before === 0) return { userId, before, after: 0 };
    await this.prisma.$transaction([
      this.prisma.transaction.create({
        data: {
          walletId: user.wallet.id,
          type: before > 0 ? "DEBIT" : "CREDIT",
          amount: Math.abs(before),
          label: "Portefeuille remis à zéro par l'administrateur",
          meta: `Par ${adminId}${reason ? ` : ${reason}` : ""}`,
          kind: "ADMIN_RESET",
        },
      }),
      this.prisma.wallet.update({ where: { id: user.wallet.id }, data: { balance: 0 } }),
    ]);
    return { userId, before, after: 0 };
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
      select: {
        id: true,
        phone: true,
        fullName: true,
        role: true,
        status: true,
        createdAt: true,
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

  /** Supprime (ou anonymise, s'il a un historique) un compte client. Voir client-deletion.ts pour les règles. */
  deleteClient(adminId: string, userId: string, settleBalance = false) {
    return deleteClientAccount(this.prisma, adminId, userId, { settleBalance });
  }

  async getUserNpi(adminId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, npiCipher: true },
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");
    if (!user.npiCipher) throw new NotFoundException("NPI indisponible");

    await this.prisma.npiAccessAudit.create({
      data: { actorId: adminId, targetId: user.id },
    });
    return { userId: user.id, npi: this.npiCrypto.decrypt(user.npiCipher) };
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
  constructor(private svc: AdminService, private finance: FinanceService, private wallet: WalletService) {}

  // GET /admin/finance — gains de l'entreprise (par source et par mois), retraits et montant disponible
  @Get("finance")
  financeSummary() {
    return this.finance.summary();
  }

  // GET /admin/finance/commissions?limit=50 — commission prélevée sur chaque course et livraison (montant, pourcentage, somme)
  @Get("finance/commissions")
  commissions(@Query("limit") limit?: string) {
    return this.finance.commissions(limit ? Number(limit) : 50);
  }

  @Get("finance/withdrawals")
  withdrawals() {
    return this.finance.listWithdrawals();
  }

  // POST /admin/finance/withdrawals { amount, phone, method?, note? } — demande de retrait (refusée au-delà du disponible)
  @Post("finance/withdrawals")
  requestWithdrawal(@CurrentUser() u, @Body() dto: WithdrawalDto) {
    return this.finance.requestWithdrawal(u.userId, dto);
  }

  // POST /admin/finance/withdrawals/:id/paid { reference? } — l'argent a été versé
  @Post("finance/withdrawals/:id/paid")
  markWithdrawalPaid(@CurrentUser() u, @Param("id") id: string, @Body() dto: MarkPaidDto) {
    return this.finance.markPaid(u.userId, id, dto.reference);
  }

  // POST /admin/finance/withdrawals/:id/cancel — annule une demande en attente
  @Post("finance/withdrawals/:id/cancel")
  cancelWithdrawal(@CurrentUser() u, @Param("id") id: string) {
    return this.finance.cancel(u.userId, id);
  }

  // GET /admin/finance/phone-commissions — commissions téléphone prélevées, par Speeder, à reverser aux boutiques partenaires
  @Get("finance/phone-commissions")
  phoneCommissions() {
    return this.finance.phoneCommissions();
  }

  @Get("stats")
  stats() {
    return this.svc.stats();
  }

  @Get("users")
  users(@Query("q") q?: string, @Query("role") role?: string) {
    return this.svc.users(q, role);
  }

  @Get("users/:id/npi")
  userNpi(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.getUserNpi(u.userId, id);
  }

  // POST /admin/users/:id/ratings-reset — repart de zéro côté notes (client ou chauffeur)
  @Post("users/:id/ratings-reset")
  resetRatings(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.resetRatings(u.userId, id);
  }

  // POST /admin/users/:id/name {firstName, lastName?} — corrige le nom d'une personne
  @Post("users/:id/name")
  renameUser(@CurrentUser() u, @Param("id") id: string, @Body() dto: UpdateUserNameDto) {
    return this.svc.renameUser(u.userId, id, dto);
  }

  // POST /admin/users/:id/wallet-reset {reason?} — remet le portefeuille d'un client ou prestataire à zéro (écriture conservée)
  @Post("users/:id/wallet-reset")
  resetWallet(@CurrentUser() u, @Param("id") id: string, @Body() dto: { reason?: string }) {
    return this.svc.resetWallet(u.userId, id, typeof dto?.reason === "string" ? dto.reason.slice(0, 200) : undefined);
  }

  // DELETE /admin/users/:id[?settle=1] — supprime un compte client (anonymisé s'il a un historique) ; settle=1 remet son solde à zéro
  @Delete("users/:id")
  deleteClient(@CurrentUser() u, @Param("id") id: string, @Query("settle") settle?: string) {
    return this.svc.deleteClient(u.userId, id, settle === "1");
  }

  @Post("users/:id/status")
  setUserStatus(@CurrentUser() u, @Param("id") id: string, @Body() dto: UpdateUserStatusDto) {
    return this.svc.setUserStatus(u.userId, id, dto);
  }

  // Retraits demandés par les prestataires : à payer sur leur Mobile Money, puis à marquer payés (ou à refuser : le montant est rendu).
  @Get("provider-withdrawals")
  providerWithdrawals(@Query("status") status?: string) {
    return this.wallet.listProviderWithdrawals(["PENDING", "CONFIRMED", "FAILED"].includes(status ?? "") ? (status as "PENDING" | "CONFIRMED" | "FAILED") : undefined);
  }

  @Post("provider-withdrawals/:id/paid")
  providerWithdrawalPaid(@CurrentUser() u, @Param("id") id: string, @Body() dto: ProviderWithdrawalPaidDto) {
    return this.wallet.markWithdrawalPaid(u.userId, id, dto.reference);
  }

  @Post("provider-withdrawals/:id/reject")
  providerWithdrawalReject(@CurrentUser() u, @Param("id") id: string, @Body() dto: ProviderWithdrawalRejectDto) {
    return this.wallet.rejectWithdrawal(u.userId, id, dto.reason);
  }

  @Get("audit-log")
  auditLog() {
    return this.svc.auditLog();
  }

  // POST /admin/settlements/zem-monthly  { "period": "2026-09" }
  // Prélèvement mensuel des Spider indépendants : 15 % des revenus du mois (idempotent).
  @Post("settlements/zem-monthly")
  zemMonthly(@Body() dto: MonthlySettlementDto) {
    return this.svc.chargeZemMonthly(dto.period);
  }
}

@Module({
  imports: [WalletModule, PricingModule, UsersModule],
  controllers: [AdminController],
  providers: [AdminService, FinanceService],
})
export class AdminModule {}
