import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
  Delete,
} from "@nestjs/common";
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { beninPhoneVariants, extractLocalBeninDigits, normalizeBeninPhone } from "../common/phone";
import {
  ACTIVE_WINDOW_DAYS,
  REFERRAL_KINDS,
  ReferralKind,
  ReferralStatus,
  generateReferralCode,
  kindOf,
  maskPhone,
  normalizeReferralCode,
  statusOf,
} from "./referral-logic";

export class CreateReferrerDto {
  @IsString() @MinLength(2) @MaxLength(80) fullName: string;
  @IsString() @MaxLength(20) phone: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class UpdateReferrerDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class AttachDto {
  @IsString() @MaxLength(20) phone: string;
}

type KindSummary = {
  total: number;
  enAttente: number;
  actifs: number;
  inactifs: number;
  autres: number;
  ontRecharge: number;
  montantRecharge: number;
};

const emptyKind = (): KindSummary => ({ total: 0, enAttente: 0, actifs: 0, inactifs: 0, autres: 0, ontRecharge: 0, montantRecharge: 0 });

export type ReferralItem = {
  userId: string;
  name: string;
  phone: string;
  kind: ReferralKind | null;
  status: ReferralStatus;
  providerStatus: string | null;
  city: string | null;
  vehicleType: string | null;
  agencyName: string | null;
  fleetSize: number | null;
  referredAt: string | null;
  registeredAt: string;
  approvedAt: string | null;
  lastActivityAt: string | null;
  jobsTotal: number;
  jobsLast30Days: number;
  recharged: boolean;
  rechargeCount: number;
  rechargedTotal: number;
  lastRechargeAt: string | null;
};

@Injectable()
export class ReferralsService {
  constructor(private prisma: PrismaService) {}

  private validPhone(raw: string): { phone: string; variants: string[] } {
    const local = extractLocalBeninDigits(raw);
    if (local.length !== 10 && local.length !== 8) throw new BadRequestException("Numéro béninois invalide : 10 chiffres commençant par 01.");
    if (local.length === 10 && !local.startsWith("01")) throw new BadRequestException("Au Bénin, un numéro à 10 chiffres commence par 01.");
    return { phone: normalizeBeninPhone(raw), variants: beninPhoneVariants(raw) };
  }

  private async uniqueCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = generateReferralCode();
      if (!(await this.prisma.referrer.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
    throw new ConflictException("Impossible de générer un code de parrainage, réessaie.");
  }

  /* ------------------------------------------------------------------ inscription d'un filleul */

  /**
   * Rattache un nouveau prestataire à son parrain à partir du code saisi à l'inscription.
   * Jamais bloquant : un code inconnu ou refusé est simplement signalé à l'application.
   */
  async attachByCode(userId: string, rawCode: string | null | undefined): Promise<"APPLIED" | "INVALID" | "IGNORED"> {
    if (rawCode === undefined || rawCode === null || String(rawCode).trim() === "") return "IGNORED";
    const code = normalizeReferralCode(rawCode);
    if (!code) return "INVALID";
    const referrer = await this.prisma.referrer.findUnique({ where: { code } });
    if (!referrer || !referrer.active || referrer.userId === userId) return "INVALID";
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { referrerId: true, profileCompletedAt: true, referrerProfile: { select: { id: true } } } });
    if (!user) return "INVALID";
    // Un compte déjà parrainé, un client inscrit avec son identité ou un parrain ne peuvent pas être rattachés par ce biais
    if (user.referrerId || user.profileCompletedAt || user.referrerProfile) return "IGNORED";
    await this.prisma.user.update({ where: { id: userId }, data: { referrerId: referrer.id, referredAt: new Date() } });
    return "APPLIED";
  }

  /** Le compte est-il un parrain ? (renvoyé à la connexion pour ouvrir l'espace parrain) */
  async referrerOf(userId: string) {
    const r = await this.prisma.referrer.findUnique({ where: { userId }, select: { code: true, active: true } });
    return r ? { code: r.code, active: r.active } : null;
  }

  /* ------------------------------------------------------------------ suivi des filleuls */

  /** Suivi complet des filleuls d'un parrain : chiffres par catégorie et fiche de chacun. */
  async overview(referrerId: string, options: { maskPhones: boolean }, now: Date = new Date()) {
    const users = await this.prisma.user.findMany({
      where: { referrerId },
      orderBy: { referredAt: "desc" },
      select: {
        id: true,
        phone: true,
        fullName: true,
        createdAt: true,
        referredAt: true,
        signupKind: true,
        agencyId: true,
        wallet: { select: { id: true } },
        provider: { select: { type: true, status: true, categoryId: true, fullName: true, city: true, vehicleType: true, agencyName: true, activatedAt: true } },
      },
    });

    const since = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 3600 * 1000);

    // Équipe d'une agence : ses chauffeurs rattachés (le propriétaire, lui, n'est pas une place de la flotte)
    const agencyIds = users.filter((u) => u.provider?.type === "AGENCY" && u.agencyId).map((u) => u.agencyId as string);
    const ownerIds = users.map((u) => u.id);
    const members = agencyIds.length
      ? await this.prisma.user.findMany({ where: { agencyId: { in: agencyIds }, id: { notIn: ownerIds } }, select: { id: true, agencyId: true } })
      : [];
    const membersByAgency = new Map<string, string[]>();
    for (const m of members) membersByAgency.set(m.agencyId as string, [...(membersByAgency.get(m.agencyId as string) ?? []), m.id]);

    const actorIds = [...users.map((u) => u.id), ...members.map((m) => m.id)];
    const walletIds = users.map((u) => u.wallet?.id).filter((id): id is string => !!id);

    const [ridesAll, ridesRecent, deliveriesAll, deliveriesRecent, recharges] = actorIds.length
      ? await Promise.all([
          this.prisma.ride.groupBy({ by: ["driverId"], where: { driverId: { in: actorIds }, status: "COMPLETED" }, _count: { _all: true }, _max: { completedAt: true } }),
          this.prisma.ride.groupBy({ by: ["driverId"], where: { driverId: { in: actorIds }, status: "COMPLETED", completedAt: { gte: since } }, _count: { _all: true } }),
          this.prisma.delivery.groupBy({ by: ["courierId"], where: { courierId: { in: actorIds }, status: "COMPLETED" }, _count: { _all: true }, _max: { createdAt: true } }),
          this.prisma.delivery.groupBy({ by: ["courierId"], where: { courierId: { in: actorIds }, status: "COMPLETED", createdAt: { gte: since } }, _count: { _all: true } }),
          walletIds.length
            ? this.prisma.transaction.groupBy({ by: ["walletId"], where: { walletId: { in: walletIds }, kind: "RECHARGE", status: "CONFIRMED" }, _sum: { amount: true }, _count: { _all: true }, _max: { createdAt: true } })
            : Promise.resolve([] as { walletId: string; _sum: { amount: number | null }; _count: { _all: number }; _max: { createdAt: Date | null } }[]),
        ])
      : [[], [], [], [], []];

    type Act = { total: number; recent: number; last: Date | null };
    const act = new Map<string, Act>();
    const bump = (id: string | null, total: number, last: Date | null, recent = 0) => {
      if (!id) return;
      const a = act.get(id) ?? { total: 0, recent: 0, last: null };
      a.total += total;
      a.recent += recent;
      if (last && (!a.last || last > a.last)) a.last = last;
      act.set(id, a);
    };
    for (const r of ridesAll as any[]) bump(r.driverId, r._count._all, r._max.completedAt);
    for (const r of ridesRecent as any[]) bump(r.driverId, 0, null, r._count._all);
    for (const d of deliveriesAll as any[]) bump(d.courierId, d._count._all, d._max.createdAt);
    for (const d of deliveriesRecent as any[]) bump(d.courierId, 0, null, d._count._all);
    const rechargeByWallet = new Map((recharges as any[]).map((r) => [r.walletId, r]));

    const items: ReferralItem[] = users.map((u) => {
      const own = act.get(u.id) ?? { total: 0, recent: 0, last: null };
      let jobsTotal = own.total;
      let jobsRecent = own.recent;
      let last = own.last;
      // Une agence : l'activité de sa flotte compte pour elle
      const team = u.provider?.type === "AGENCY" && u.agencyId ? membersByAgency.get(u.agencyId) ?? [] : [];
      for (const memberId of team) {
        const m = act.get(memberId);
        if (!m) continue;
        jobsTotal += m.total;
        jobsRecent += m.recent;
        if (m.last && (!last || m.last > last)) last = m.last;
      }
      const rc: any = u.wallet ? rechargeByWallet.get(u.wallet.id) : null;
      const kind = kindOf(u.provider, u.signupKind);
      return {
        userId: u.id,
        name: u.provider?.fullName || u.fullName || "Sans nom",
        phone: options.maskPhones ? maskPhone(u.phone) : u.phone,
        kind,
        status: statusOf(u.provider?.status, last, now),
        providerStatus: u.provider?.status ?? null,
        city: u.provider?.city ?? null,
        vehicleType: u.provider?.vehicleType ?? null,
        agencyName: u.provider?.agencyName ?? null,
        fleetSize: u.provider?.type === "AGENCY" ? team.length : null,
        referredAt: u.referredAt?.toISOString() ?? null,
        registeredAt: u.createdAt.toISOString(),
        approvedAt: u.provider?.activatedAt?.toISOString() ?? null,
        lastActivityAt: last?.toISOString() ?? null,
        jobsTotal,
        jobsLast30Days: jobsRecent,
        recharged: !!rc && (rc._count._all ?? 0) > 0,
        rechargeCount: rc?._count._all ?? 0,
        rechargedTotal: rc?._sum.amount ?? 0,
        lastRechargeAt: rc?._max.createdAt ? new Date(rc._max.createdAt).toISOString() : null,
      };
    });

    const byKind = Object.fromEntries(REFERRAL_KINDS.map((k) => [k, emptyKind()])) as Record<ReferralKind, KindSummary>;
    const totals = emptyKind();
    let unclassified = 0;
    for (const it of items) {
      const bucket = it.kind ? byKind[it.kind] : null;
      if (!bucket) unclassified++;
      for (const t of bucket ? [bucket, totals] : [totals]) {
        t.total++;
        if (it.status === "EN_ATTENTE") t.enAttente++;
        else if (it.status === "ACTIF") t.actifs++;
        else if (it.status === "INACTIF") t.inactifs++;
        else t.autres++;
        if (it.recharged) {
          t.ontRecharge++;
          t.montantRecharge += it.rechargedTotal;
        }
      }
    }
    return { summary: { activeWindowDays: ACTIVE_WINDOW_DAYS, byKind, totals, unclassified }, referrals: items };
  }

  /** Espace du parrain : ses chiffres et ses filleuls (numéros partiellement masqués). */
  async myOverview(userId: string) {
    const referrer = await this.prisma.referrer.findUnique({ where: { userId }, include: { user: { select: { fullName: true } } } });
    if (!referrer) throw new ForbiddenException("Ce compte n'est pas un parrain AZƆ̀.");
    if (!referrer.active) throw new ForbiddenException("Ton compte parrain est désactivé : contacte AZƆ̀.");
    const data = await this.overview(referrer.id, { maskPhones: true });
    return { referrer: { id: referrer.id, code: referrer.code, fullName: referrer.user.fullName, createdAt: referrer.createdAt.toISOString() }, ...data };
  }

  /* ------------------------------------------------------------------ administration */

  async createReferrer(adminId: string, dto: CreateReferrerDto) {
    const { phone, variants } = this.validPhone(dto.phone);
    const fullName = dto.fullName.trim().replace(/\s+/g, " ");
    const parts = fullName.split(" ");
    const lastName = parts.length > 1 ? parts[parts.length - 1] : null;
    const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];

    const existing = await this.prisma.user.findFirst({
      where: { phone: { in: variants } },
      select: { id: true, role: true, profileCompletedAt: true, agencyId: true, provider: { select: { id: true } }, referrerProfile: { select: { id: true } } },
    });
    if (existing?.referrerProfile) throw new ConflictException("Ce numéro est déjà celui d'un parrain.");
    if (existing && (existing.provider || existing.profileCompletedAt || existing.agencyId || existing.role !== "CLIENT")) {
      throw new ConflictException("Ce numéro a déjà un compte AZƆ̀ (client inscrit ou prestataire) : utilise un autre numéro pour le parrain.");
    }

    const code = await this.uniqueCode();
    const user = existing
      ? await this.prisma.user.update({ where: { id: existing.id }, data: { fullName, firstName, lastName } })
      : await this.prisma.user.create({ data: { phone, fullName, firstName, lastName, wallet: { create: {} } } });
    const referrer = await this.prisma.referrer.create({ data: { userId: user.id, code, note: dto.note?.trim() || null, createdById: adminId } });
    return { id: referrer.id, userId: user.id, code, fullName, phone: user.phone, active: true };
  }

  async listReferrers() {
    const referrers = await this.prisma.referrer.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { fullName: true, phone: true } } },
    });
    return Promise.all(
      referrers.map(async (r) => {
        const { summary } = await this.overview(r.id, { maskPhones: false });
        return {
          id: r.id,
          code: r.code,
          active: r.active,
          note: r.note,
          fullName: r.user.fullName,
          phone: r.user.phone,
          createdAt: r.createdAt.toISOString(),
          totals: summary.totals,
          byKind: summary.byKind,
        };
      })
    );
  }

  async referrerDetail(id: string) {
    const r = await this.prisma.referrer.findUnique({ where: { id }, include: { user: { select: { fullName: true, phone: true } } } });
    if (!r) throw new NotFoundException("Parrain introuvable");
    const data = await this.overview(r.id, { maskPhones: false });
    return { referrer: { id: r.id, code: r.code, active: r.active, note: r.note, fullName: r.user.fullName, phone: r.user.phone, createdAt: r.createdAt.toISOString() }, ...data };
  }

  async updateReferrer(id: string, dto: UpdateReferrerDto) {
    const r = await this.prisma.referrer.findUnique({ where: { id } });
    if (!r) throw new NotFoundException("Parrain introuvable");
    await this.prisma.referrer.update({ where: { id }, data: { ...(dto.active !== undefined ? { active: dto.active } : {}), ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}) } });
    return this.referrerDetail(id);
  }

  /** Rattache un prestataire existant (son numéro) à ce parrain. */
  async attach(referrerId: string, dto: AttachDto) {
    const r = await this.prisma.referrer.findUnique({ where: { id: referrerId } });
    if (!r) throw new NotFoundException("Parrain introuvable");
    const { variants } = this.validPhone(dto.phone);
    const user = await this.prisma.user.findFirst({
      where: { phone: { in: variants } },
      select: { id: true, referrerId: true, signupKind: true, provider: { select: { id: true } }, referrerProfile: { select: { id: true } } },
    });
    if (!user) throw new NotFoundException("Aucun compte avec ce numéro : le prestataire doit d'abord s'inscrire.");
    if (user.referrerProfile) throw new ConflictException("Ce numéro est celui d'un parrain.");
    if (user.id === r.userId) throw new ConflictException("Un parrain ne peut pas se parrainer lui-même.");
    if (!user.provider && user.signupKind !== "DRIVER" && user.signupKind !== "COURIER" && user.signupKind !== "AGENCY") {
      throw new BadRequestException("Seuls les prestataires (Speeder, agence, livreur, coursier) peuvent être parrainés.");
    }
    if (user.referrerId === referrerId) throw new ConflictException("Ce prestataire est déjà parrainé par ce parrain.");
    if (user.referrerId) throw new ConflictException("Ce prestataire a déjà un parrain : retire-le d'abord.");
    await this.prisma.user.update({ where: { id: user.id }, data: { referrerId, referredAt: new Date() } });
    return this.referrerDetail(referrerId);
  }

  async detach(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { referrerId: true } });
    if (!user) throw new NotFoundException("Compte introuvable");
    if (!user.referrerId) throw new BadRequestException("Ce compte n'a pas de parrain.");
    const referrerId = user.referrerId;
    await this.prisma.user.update({ where: { id: userId }, data: { referrerId: null, referredAt: null } });
    return this.referrerDetail(referrerId);
  }
}

/** Espace du parrain : ses chiffres et ses filleuls. */
@Controller("referrals")
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private svc: ReferralsService) {}

  @Get("me")
  me(@CurrentUser() u) {
    return this.svc.myOverview(u.userId);
  }
}

/** Administration des parrains. */
@Controller("admin/referrals")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminReferralsController {
  constructor(private svc: ReferralsService) {}

  @Get()
  list() {
    return this.svc.listReferrers();
  }

  @Post()
  create(@CurrentUser() u, @Body() dto: CreateReferrerDto) {
    return this.svc.createReferrer(u.userId, dto);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.svc.referrerDetail(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateReferrerDto) {
    return this.svc.updateReferrer(id, dto);
  }

  @Post(":id/attach")
  attach(@Param("id") id: string, @Body() dto: AttachDto) {
    return this.svc.attach(id, dto);
  }

  @Delete("referral/:userId")
  detach(@Param("userId") userId: string) {
    return this.svc.detach(userId);
  }
}

@Module({
  controllers: [ReferralsController, AdminReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
