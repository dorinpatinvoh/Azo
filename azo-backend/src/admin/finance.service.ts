import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeBeninPhone } from "../common/phone";

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
  constructor(private prisma: PrismaService) {}

  private async monthly(rows: Promise<MonthlyRow[]>): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const row of await rows) {
      if (!row.m) continue;
      map.set(monthKey(new Date(row.m)), (map.get(monthKey(new Date(row.m))) ?? 0) + Number(row.total ?? 0));
    }
    return map;
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
