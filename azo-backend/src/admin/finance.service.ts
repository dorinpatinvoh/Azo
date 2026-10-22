import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeBeninPhone } from "../common/phone";
import { PricingService } from "../pricing/pricing.module";

/** Retrait minimal de l'entreprise (FCFA). */
export const MIN_COMPANY_WITHDRAWAL = 1000;

/** Libellés des prélèvements mensuels des Spider indépendants (l'ancien « Zem » reste reconnu : données déjà enregistrées). */
const SPIDER_MONTHLY_LABELS = ["Prélèvement mensuel Spider", "Prélèvement mensuel Zem"];

export type RevenueSource = { key: string; label: string; total: number; thisMonth: number };

type MonthlyRow = { m: Date; total: bigint | number | null };

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Gains de l'entreprise et retraits.
 *
 * Les gains sont CALCULÉS à partir des données réelles (aucun compteur à part qui pourrait dériver) :
 *   - commissions des courses terminées (`Ride.commission`) ;
 *   - commissions des livraisons terminées (15 % du prix, comme dans les statistiques) ;
 *   - frais d'activation des agences réellement payés (débit du portefeuille « Activation agence … ») ;
 *   - frais prélevés sur les retraits AZƆ̀ Pay (paramètre `fee` des transactions de retrait) ;
 *   - prélèvements mensuels des Spider indépendants (15 % des revenus du mois).
 * Disponible au retrait = gains − retraits demandés ou versés (un retrait annulé est rendu).
 */
@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService, @Optional() private pricing?: PricingService) {}

  private async monthly(rows: Promise<MonthlyRow[]>): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const row of await rows) {
      if (!row.m) continue;
      map.set(monthKey(new Date(row.m)), (map.get(monthKey(new Date(row.m))) ?? 0) + Number(row.total ?? 0));
    }
    return map;
  }

  /**
   * Commission de l'entreprise sur chaque course et chaque livraison terminées (les plus récentes d'abord) :
   * montant de la course, pourcentage appliqué et somme prélevée.
   */
  /** Commissions téléphone prélevées sur les Speeders dont le téléphone vient d'une boutique partenaire : à reverser aux boutiques. */
  async phoneCommissions() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const where = { phoneCommission: { gt: 0 } };
    const [all, month, groups, dAll, dMonth, dGroups] = await Promise.all([
      this.prisma.ride.aggregate({ where, _sum: { phoneCommission: true }, _count: true }),
      this.prisma.ride.aggregate({ where: { ...where, completedAt: { gte: monthStart } }, _sum: { phoneCommission: true } }),
      this.prisma.ride.groupBy({
        by: ["driverId"],
        where: { ...where, driverId: { not: null } },
        _sum: { phoneCommission: true },
        _count: true,
        orderBy: { _sum: { phoneCommission: "desc" } },
        take: 100,
      }),
      this.prisma.delivery.aggregate({ where, _sum: { phoneCommission: true }, _count: true }),
      this.prisma.delivery.aggregate({ where: { ...where, status: "COMPLETED", createdAt: { gte: monthStart } }, _sum: { phoneCommission: true } }),
      this.prisma.delivery.groupBy({
        by: ["courierId"],
        where: { ...where, courierId: { not: null } },
        _sum: { phoneCommission: true },
        _count: true,
        orderBy: { _sum: { phoneCommission: "desc" } },
        take: 100,
      }),
    ]);
    // Courses (Speeders) et livraisons (coursiers, livreurs) regroupées par prestataire
    const merged = new Map<string, { rides: number; total: number }>();
    for (const g of groups) if (g.driverId) merged.set(g.driverId, { rides: g._count, total: g._sum.phoneCommission ?? 0 });
    for (const g of dGroups) {
      if (!g.courierId) continue;
      const prev = merged.get(g.courierId) ?? { rides: 0, total: 0 };
      merged.set(g.courierId, { rides: prev.rides + g._count, total: prev.total + (g._sum.phoneCommission ?? 0) });
    }
    const ordered = [...merged.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 100);
    const ids = ordered.map(([id]) => id);
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, phone: true, fullName: true, provider: { select: { id: true, phoneShop: true, phoneSupportedAt: true } } },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      total: (all._sum.phoneCommission ?? 0) + (dAll._sum.phoneCommission ?? 0),
      thisMonth: (month._sum.phoneCommission ?? 0) + (dMonth._sum.phoneCommission ?? 0),
      rides: all._count + dAll._count,
      speeders: ordered.map(([userId, v]) => {
        const u = byId.get(userId);
        return {
          userId,
          providerId: u?.provider?.id ?? null,
          fullName: u?.fullName ?? null,
          phone: u?.phone ?? null,
          shop: u?.provider?.phoneShop ?? null,
          since: u?.provider?.phoneSupportedAt ?? null,
          rides: v.rides,
          total: v.total,
        };
      }),
    };
  }

  async commissions(limit = 50) {
    const n = Math.min(Math.max(Math.floor(limit) || 50, 1), 200);
    type RideRow = {
      id: string; at: Date; amount: number; commission: number; vehicle: string | null;
      driverId: string | null; driverName: string | null; driverPhone: string | null; agencyName: string | null;
      clientName: string | null; clientPhone: string | null; origin: string | null; dest: string | null; meters: number | null;
    };
    const rides = await this.prisma.$queryRaw<RideRow[]>`
      SELECT r."id", COALESCE(r."completedAt", r."createdAt") AS at, COALESCE(r."finalPrice", r."price") AS amount, r."commission",
             r."vehicleType"::text AS vehicle, r."driverId",
             COALESCE(p."fullName", u."fullName", u."phone") AS "driverName", u."phone" AS "driverPhone", ag."name" AS "agencyName",
             COALESCE(c."fullName", c."phone") AS "clientName", c."phone" AS "clientPhone",
             r."originLabel" AS origin, r."destLabel" AS dest, COALESCE(r."settledDistanceMeters", r."traveledMeters") AS meters
      FROM "Ride" r
      LEFT JOIN "User" u ON u."id" = r."driverId"
      LEFT JOIN "ProviderProfile" p ON p."userId" = r."driverId"
      LEFT JOIN "Agency" ag ON ag."id" = u."agencyId"
      LEFT JOIN "User" c ON c."id" = r."clientId"
      WHERE r."status" = 'COMPLETED' ORDER BY COALESCE(r."completedAt", r."createdAt") DESC LIMIT ${n}`;
    type DelRow = {
      id: string; at: Date; amount: number; mode: string | null; vehicle: string | null;
      driverName: string | null; driverPhone: string | null; agencyName: string | null;
      clientName: string | null; clientPhone: string | null; origin: string | null; dest: string | null; km: number | null;
    };
    const deliveries = await this.prisma.$queryRaw<DelRow[]>`
      SELECT d."id", d."createdAt" AS at, d."price" AS amount, d."mode", d."vehicleType"::text AS vehicle,
             COALESCE(p."fullName", u."fullName", u."phone") AS "driverName", u."phone" AS "driverPhone", ag."name" AS "agencyName",
             COALESCE(c."fullName", c."phone") AS "clientName", c."phone" AS "clientPhone",
             d."pickupAddress" AS origin, d."dropAddress" AS dest, d."distanceKm" AS km
      FROM "Delivery" d
      LEFT JOIN "User" u ON u."id" = d."courierId"
      LEFT JOIN "ProviderProfile" p ON p."userId" = d."courierId"
      LEFT JOIN "Agency" ag ON ag."id" = u."agencyId"
      LEFT JOIN "User" c ON c."id" = d."clientId"
      WHERE d."status" = 'COMPLETED' ORDER BY d."createdAt" DESC LIMIT ${n}`;
    const pct = (amount: number, commission: number) => (amount > 0 ? Math.round((commission / amount) * 1000) / 10 : 0);
    const rows = [
      ...rides.map((r) => {
        const amount = Number(r.amount);
        const commission = Number(r.commission);
        return {
          kind: "RIDE" as const, id: r.id, ref: `Course #${r.id.slice(0, 6)}`, date: r.at, who: r.driverName, vehicle: r.vehicle, amount, commission, pct: pct(amount, commission),
          driverName: r.driverName, driverPhone: r.driverPhone, agencyName: r.agencyName, independent: !r.agencyName,
          clientName: r.clientName, clientPhone: r.clientPhone, origin: r.origin, dest: r.dest,
          distanceKm: r.meters != null ? Math.round((Number(r.meters) / 1000) * 1000) / 1000 : null,
        };
      }),
      ...deliveries.map((d) => {
        const amount = Number(d.amount);
        const commission = this.pricing ? this.pricing.platformCommission(amount) : Math.round(amount * 0.15);
        return {
          kind: d.mode === "PERSONAL" ? ("PERSONAL" as const) : ("DELIVERY" as const), id: d.id,
          ref: `${d.mode === "PERSONAL" ? "Coursier personnel" : "Livraison"} #${d.id.slice(0, 6)}`, date: d.at, who: d.driverName, vehicle: d.vehicle, amount, commission, pct: pct(amount, commission),
          driverName: d.driverName, driverPhone: d.driverPhone, agencyName: d.agencyName, independent: !d.agencyName,
          clientName: d.clientName, clientPhone: d.clientPhone, origin: d.origin, dest: d.dest,
          distanceKm: d.km != null ? Math.round(Number(d.km) * 1000) / 1000 : null,
        };
      }),
    ];
    return rows.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime()).slice(0, n);
  }

  /** Gains par source et par mois. */
  async revenue(now: Date = new Date()) {
    const [rides, deliveries, activations, withdrawalFees, spiderShare] = await Promise.all([
      this.monthly(
        this.prisma.$queryRaw<MonthlyRow[]>`SELECT date_trunc('month', "createdAt") AS m, COALESCE(SUM("commission"), 0) AS total FROM "Ride" WHERE "status" = 'COMPLETED' GROUP BY 1`
      ),
      this.monthly(
        this.prisma.$queryRaw<MonthlyRow[]>`SELECT date_trunc('month', "createdAt") AS m, COALESCE(SUM(ROUND("price" * 0.15)), 0) AS total FROM "Delivery" WHERE "status" = 'COMPLETED' GROUP BY 1`
      ),
      this.monthly(
        this.prisma.$queryRaw<MonthlyRow[]>`SELECT date_trunc('month', "createdAt") AS m, COALESCE(SUM("amount"), 0) AS total FROM "Transaction" WHERE "type" = 'DEBIT' AND "label" LIKE 'Activation agence %' GROUP BY 1`
      ),
      this.monthly(
        this.prisma.$queryRaw<MonthlyRow[]>`SELECT date_trunc('month', "createdAt") AS m, COALESCE(SUM(COALESCE(("labelParams"->>'fee')::int, 0)), 0) AS total FROM "Transaction" WHERE "labelKey" = 'TRANSACTION_WITHDRAWAL' GROUP BY 1`
      ),
      this.monthly(
        this.prisma.$queryRaw<MonthlyRow[]>`SELECT date_trunc('month', "createdAt") AS m, COALESCE(SUM("amount"), 0) AS total FROM "Transaction" WHERE "type" = 'DEBIT' AND "label" IN (${SPIDER_MONTHLY_LABELS[0]}, ${SPIDER_MONTHLY_LABELS[1]}) GROUP BY 1`
      ),
    ]);

    const current = monthKey(now);
    const sum = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0);
    const sources: RevenueSource[] = [
      { key: "RIDE_COMMISSIONS", label: "Commissions des courses", total: sum(rides), thisMonth: rides.get(current) ?? 0 },
      { key: "DELIVERY_COMMISSIONS", label: "Commissions des livraisons", total: sum(deliveries), thisMonth: deliveries.get(current) ?? 0 },
      { key: "AGENCY_ACTIVATIONS", label: "Activations d'agences", total: sum(activations), thisMonth: activations.get(current) ?? 0 },
      { key: "WITHDRAWAL_FEES", label: "Frais sur les retraits", total: sum(withdrawalFees), thisMonth: withdrawalFees.get(current) ?? 0 },
      { key: "SPIDER_MONTHLY_SHARE", label: "Part mensuelle des Spider", total: sum(spiderShare), thisMonth: spiderShare.get(current) ?? 0 },
    ];

    // Les 6 derniers mois, du plus ancien au plus récent
    const months: { month: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = monthKey(d);
      months.push({
        month: key,
        total: [rides, deliveries, activations, withdrawalFees, spiderShare].reduce((acc, map) => acc + (map.get(key) ?? 0), 0),
      });
    }

    return {
      sources,
      total: sources.reduce((a, s) => a + s.total, 0),
      thisMonth: sources.reduce((a, s) => a + s.thisMonth, 0),
      months,
    };
  }

  /** Retraits déjà demandés ou versés (un retrait annulé n'est pas compté). */
  private async committed(): Promise<{ requested: number; paid: number }> {
    const grouped = await this.prisma.companyWithdrawal.groupBy({
      by: ["status"],
      where: { status: { in: ["REQUESTED", "PAID"] } },
      _sum: { amount: true },
    });
    const get = (status: string) => grouped.find((g) => g.status === status)?._sum.amount ?? 0;
    return { requested: get("REQUESTED"), paid: get("PAID") };
  }

  async summary() {
    const [revenue, committed] = await Promise.all([this.revenue(), this.committed()]);
    const withdrawn = committed.requested + committed.paid;
    return {
      currency: "FCFA",
      ...revenue,
      withdrawn,
      pendingWithdrawals: committed.requested,
      paidWithdrawals: committed.paid,
      available: Math.max(revenue.total - withdrawn, 0),
      minWithdrawal: MIN_COMPANY_WITHDRAWAL,
    };
  }

  listWithdrawals() {
    return this.prisma.companyWithdrawal.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  }

  /** Demande de retrait : refusée au-delà du montant disponible. Les demandes simultanées sont traitées l'une après l'autre. */
  async requestWithdrawal(adminId: string, dto: { amount: number; phone: string; method?: string; note?: string }) {
    if (!Number.isInteger(dto.amount) || dto.amount < MIN_COMPANY_WITHDRAWAL) {
      throw new BadRequestException(`Le retrait minimum est de ${MIN_COMPANY_WITHDRAWAL.toLocaleString("fr-FR")} FCFA.`);
    }
    const phone = normalizeBeninPhone(dto.phone);
    if (!/^\+229\d{10}$/.test(phone)) {
      throw new BadRequestException("Numéro Mobile Money invalide : 10 chiffres commençant par 01 attendus.");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT TRUE AS locked FROM (SELECT pg_advisory_xact_lock(hashtext('company-withdrawal'))) AS lock_result`;
      const [revenue, committed] = await Promise.all([this.revenue(), this.committed()]);
      const available = revenue.total - committed.requested - committed.paid;
      if (dto.amount > available) {
        throw new BadRequestException(
          `Montant supérieur aux gains disponibles (${Math.max(available, 0).toLocaleString("fr-FR")} FCFA).`
        );
      }
      return tx.companyWithdrawal.create({
        data: { amount: dto.amount, phone, method: dto.method ?? null, note: dto.note?.trim() || null, requestedById: adminId },
      });
    });
  }

  /** L'argent a été versé sur le compte Mobile Money : on garde la référence de l'opération. */
  async markPaid(adminId: string, id: string, reference?: string) {
    const withdrawal = await this.prisma.companyWithdrawal.findUnique({ where: { id } });
    if (!withdrawal) throw new NotFoundException("Retrait introuvable");
    if (withdrawal.status !== "REQUESTED") throw new BadRequestException("Seul un retrait en attente peut être marqué comme versé.");
    const { count } = await this.prisma.companyWithdrawal.updateMany({
      where: { id, status: "REQUESTED" },
      data: { status: "PAID", paidAt: new Date(), decidedById: adminId, reference: reference?.trim() || null },
    });
    if (count !== 1) throw new BadRequestException("Ce retrait vient d'être modifié : actualise l'écran.");
    return this.prisma.companyWithdrawal.findUnique({ where: { id } });
  }

  /** Annule un retrait en attente : le montant redevient disponible. */
  async cancel(adminId: string, id: string) {
    const withdrawal = await this.prisma.companyWithdrawal.findUnique({ where: { id } });
    if (!withdrawal) throw new NotFoundException("Retrait introuvable");
    if (withdrawal.status !== "REQUESTED") throw new BadRequestException("Seul un retrait en attente peut être annulé.");
    const { count } = await this.prisma.companyWithdrawal.updateMany({
      where: { id, status: "REQUESTED" },
      data: { status: "CANCELLED", decidedById: adminId },
    });
    if (count !== 1) throw new BadRequestException("Ce retrait vient d'être modifié : actualise l'écran.");
    return this.prisma.companyWithdrawal.findUnique({ where: { id } });
  }
}
