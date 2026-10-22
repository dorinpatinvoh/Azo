import { NotificationsService } from "../notifications/notifications.module";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.service";
import { FedaPayService } from "./fedapay.service";
import { extractLocalBeninDigits, normalizeBeninPhone } from "../common/phone";
import { Prisma, TransactionStatus, TransactionType } from "@prisma/client";

const MONTHLY_ZEM_SETTLEMENT_LABEL = "Prélèvement mensuel Spider";
// Ancien libellé (avant le renommage « Zem » → « Spider ») : les prélèvements déjà enregistrés le portent encore. Il reste reconnu
// pour qu'un mois déjà prélevé ne soit JAMAIS prélevé une seconde fois.
const MONTHLY_ZEM_SETTLEMENT_LABELS = [MONTHLY_ZEM_SETTLEMENT_LABEL, "Prélèvement mensuel Zem"];

/** Recharge minimale par FedaPay (FCFA). Le mobile applique la même valeur (config/wallet.ts). */
export const MIN_RECHARGE = 300;

/** Retrait minimal d'un prestataire vers son Mobile Money (FCFA). */
export const MIN_PROVIDER_WITHDRAWAL = 1000;

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private fedaPay: FedaPayService,
    private notifications?: NotificationsService,
  ) {}

  async getWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId } });
    }
    return wallet;
  }

  async transactions(userId: string) {
    const wallet = await this.getWallet(userId);
    return this.prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async initRecharge(userId: string, amount: number, email?: string) {
    if (!Number.isInteger(amount) || amount < MIN_RECHARGE)
      throw new BadRequestException(`Le montant minimum de recharge est de ${MIN_RECHARGE} FCFA`);
    // Relire l'email depuis la base — l'objet JWT ne le contient pas.
    if (!email) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      email = user?.email ?? undefined;
    }
    // Repli si l'utilisateur n'a pas d'e-mail (inscription par téléphone uniquement).
    const safeEmail = email || `${userId}@azo.placeholder`;

    let created: Awaited<ReturnType<FedaPayService["createTransaction"]>>;
    try {
      created = await this.fedaPay.createTransaction(amount, safeEmail, `Recharge AZO ${amount} FCFA`);
    } catch (e) {
      // Cause réelle dans les logs (jamais de clé), message clair pour l'utilisateur au lieu d'une erreur 500 muette.
      const detail = String((e as { message?: string })?.message ?? e).slice(0, 300);
      const errors = JSON.stringify((e as { errors?: unknown })?.errors ?? "").slice(0, 300);
      new Logger("WalletService").error(`FedaPay a refusé la recharge de ${amount} FCFA : ${detail} ${errors}`);
      throw new BadRequestException(
        `Le service de paiement a refusé cette recharge de ${amount.toLocaleString("fr-FR")} FCFA (${detail}). Essaie un montant plus petit ou réessaie dans un instant.`
      );
    }
    const { transaction, token } = created;
    const wallet = await this.getWallet(userId);
    // La transaction est enregistrée comme CREDIT PENDING (et non DEBIT) pour qu'elle
    // apparaisse correctement dans l'historique : c'est un crédit attendu, pas une dépense.
    // Le webhook FedaPay (POST /wallet/recharge/callback) la confirmera en CONFIRMED et
    // créditera réellement le solde.
    await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.CREDIT,
        status: TransactionStatus.PENDING,
        amount,
        label: "Recharge en attente FedaPay",
        labelKey: "TRANSACTION_RECHARGE_PENDING",
        labelParams: { amount },
        meta: `fedaPayId:${transaction.id}`,
      },
    });
    return { url: token.url, transactionId: transaction.id };
  }

  /**
   * Passe une recharge en attente à CONFIRMED et crédite le solde, UNE seule fois : le passage PENDING → CONFIRMED est une
   * écriture conditionnelle (`updateMany` sur le statut) dans la même transaction que le crédit. Le webhook et le contrôle
   * automatique (reconcilePendingRecharges) peuvent donc arriver en même temps sans jamais créditer deux fois.
   */
  private async confirmPendingRecharge(pending: { id: string; walletId: string; amount: number }): Promise<boolean> {
    const credited = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.transaction.updateMany({
        where: { id: pending.id, status: TransactionStatus.PENDING },
        data: { status: TransactionStatus.CONFIRMED },
      });
      if (count !== 1) return false;
      await tx.wallet.update({ where: { id: pending.walletId }, data: { balance: { increment: pending.amount } } });
      return true;
    });
    if (credited) void this.notifyRecharge(pending.walletId, pending.amount, true);
    return credited;
  }

  /** Prévient l'utilisateur (notification poussée) que sa recharge est créditée ou a échoué. Au mieux : ne bloque jamais le crédit. */
  private async notifyRecharge(walletId: string, amount: number, ok: boolean): Promise<void> {
    if (!this.notifications) return;
    try {
      const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId }, select: { userId: true } });
      if (!wallet) return;
      await this.notifications.push(
        wallet.userId,
        ok ? "Compte rechargé" : "Recharge non aboutie",
        ok
          ? `+${amount} FCFA ajoutés à ton portefeuille AZƆ̀ Pay.`
          : "Ton paiement n'a pas abouti : aucun montant n'a été ajouté. Tu peux réessayer.",
        "payment",
        {
          titleKey: ok ? "NOTIFICATION_WALLET_RECHARGED" : "NOTIFICATION_WALLET_RECHARGE_FAILED",
          params: { amount },
          data: { event: ok ? "wallet-recharged" : "wallet-recharge-failed", amount },
        }
      );
    } catch {
      // la notification est facultative
    }
  }

  /**
   * Callback FedaPay — crédite le solde si le paiement est approuvé.
   *
   * FedaPay envoie un événement `transaction.approved` en POST sur le webhook. On relit le statut chez FedaPay, on trouve la
   * transaction PENDING correspondante via le fedaPayId dans le meta, on la passe à CONFIRMED et on incrémente le solde.
   * Introuvable ou déjà traitée : réponse sans effet (idempotence — FedaPay peut réémettre l'événement).
   */
  async handleFedaPayCallback(fedaPayTransactionId: number) {
    const remote = await this.fedaPay.verifyTransaction(fedaPayTransactionId);
    // L'objet FedaPay expose `status` comme une string (ex. "approved", "declined").
    const remoteStatus = (remote as any)?.status ?? "";
    if (remoteStatus !== "approved") return { credited: false, reason: "not_approved", remoteStatus };

    const meta = `fedaPayId:${fedaPayTransactionId}`;
    const pending = await this.prisma.transaction.findFirst({
      where: { meta, type: TransactionType.CREDIT, status: TransactionStatus.PENDING },
    });
    if (!pending) return { credited: false, reason: "already_processed_or_not_found" };

    const credited = await this.confirmPendingRecharge(pending);
    return credited
      ? { credited: true, amount: pending.amount, walletId: pending.walletId }
      : { credited: false, reason: "already_processed_or_not_found" };
  }

  private lastReconcile = new Map<string, number>();

  /**
   * Contrôle automatique des recharges en attente : pour chaque recharge FedaPay encore PENDING (moins de 48 h), on demande son
   * statut à FedaPay ; approuvée → crédit, refusée / annulée / expirée → passée en FAILED. Appelé quand l'application lit le
   * solde ou l'historique : le solde se met à jour tout seul, MÊME SI le webhook n'est jamais arrivé (serveur en veille, adresse du
   * webhook périmée, essai en local). Au plus un contrôle toutes les 1,5 s par utilisateur ; ne lève jamais d'erreur.
   */
  async reconcilePendingRecharges(userId: string, now: number = Date.now()): Promise<number> {
    const last = this.lastReconcile.get(userId) ?? 0;
    if (now - last < 1_500) return 0;
    this.lastReconcile.set(userId, now);
    try {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) return 0;
      const pending = await this.prisma.transaction.findMany({
        where: {
          walletId: wallet.id,
          type: TransactionType.CREDIT,
          status: TransactionStatus.PENDING,
          meta: { startsWith: "fedaPayId:" },
          createdAt: { gte: new Date(now - 48 * 3600 * 1000) },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      let credited = 0;
      for (const tx of pending) {
        const id = Number(String(tx.meta).slice("fedaPayId:".length));
        if (!Number.isInteger(id)) continue;
        try {
          const remote = await this.fedaPay.verifyTransaction(id);
          const status = String((remote as any)?.status ?? "");
          if (status === "approved") {
            if (await this.confirmPendingRecharge(tx)) credited += 1;
          } else if (["declined", "canceled", "cancelled", "expired"].includes(status)) {
            const failed = await this.prisma.transaction.updateMany({
              where: { id: tx.id, status: TransactionStatus.PENDING },
              data: { status: TransactionStatus.FAILED },
            });
            if (failed.count === 1) void this.notifyRecharge(tx.walletId, tx.amount, false);
          }
        } catch {
          // FedaPay injoignable pour cette transaction : on réessaiera au prochain contrôle
        }
      }
      return credited;
    } catch {
      return 0;
    }
  }

  async credit(userId: string, amount: number, label: string, meta?: string, labelKey?: string, labelParams?: Prisma.InputJsonValue) {
    const wallet = await this.getWallet(userId);
    const [updated] = await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.CREDIT,
          amount,
          label,
          meta,
          ...(labelKey ? { labelKey } : {}),
          ...(labelParams !== undefined ? { labelParams } : {}),
        },
      }),
    ]);
    return updated;
  }

  async transfer(
    fromUserId: string,
    toUserId: string,
    debitAmount: number,
    creditAmount: number,
    fromLabel: string,
    toLabel: string,
    meta?: string,
  ) {
    const from = await this.getWallet(fromUserId);
    if (from.balance < debitAmount) throw new BadRequestException("Solde insuffisant");
    const to = await this.getWallet(toUserId);
    await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: from.id }, data: { balance: { decrement: debitAmount } } }),
      this.prisma.transaction.create({ data: { walletId: from.id, type: TransactionType.DEBIT, amount: debitAmount, label: fromLabel, meta } }),
      this.prisma.wallet.update({ where: { id: to.id }, data: { balance: { increment: creditAmount } } }),
      this.prisma.transaction.create({ data: { walletId: to.id, type: TransactionType.CREDIT, amount: creditAmount, label: toLabel, meta } }),
    ]);
    return { debited: debitAmount, credited: creditAmount };
  }

  /**
   * Verse la commission de l'entreprise (15 %) sur le portefeuille de l'administrateur, DANS la transaction de la course
   * ou de la livraison (tout réussit ou rien). Sans compte administrateur actif, ne fait rien (le gain reste calculé
   * côté finances de l'entreprise).
   */
  async creditPlatformInTx(tx: Prisma.TransactionClient, amount: number, ref: string, label = "Commission AZƆ̀"): Promise<boolean> {
    if (!(amount > 0)) return false;
    const admin = await tx.user.findFirst({ where: { role: "ADMIN", status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!admin) return false;
    const wallet = await tx.wallet.upsert({ where: { userId: admin.id }, create: { userId: admin.id }, update: {} });
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } });
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.CREDIT,
        amount,
        label,
        meta: ref,
      },
    });
    return true;
  }

  /**
   * Règlement d'une livraison, en une seule transaction : le client est débité du prix (si c'est lui qui paie), le coursier
   * reçoit le net et l'entreprise sa commission (portefeuille administrateur).
   */
  async settleDelivery(p: { clientId: string | null; courierId: string; price: number; net: number; commission: number; phoneCommission?: number; dropAddress: string; ref: string }) {
    await this.getWallet(p.courierId);
    if (p.clientId) await this.getWallet(p.clientId);
    await this.prisma.$transaction(async (tx) => {
      const courierWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: p.courierId } });
      if (p.clientId) {
        const clientWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: p.clientId } });
        const debit = await tx.wallet.updateMany({ where: { id: clientWallet.id, balance: { gte: p.price } }, data: { balance: { decrement: p.price } } });
        if (debit.count !== 1) throw new BadRequestException("Solde insuffisant");
        await tx.transaction.create({ data: { walletId: clientWallet.id, type: TransactionType.DEBIT, amount: p.price, label: `Livraison colis (${p.dropAddress})`, meta: p.ref } });
      }
      await tx.wallet.update({ where: { id: courierWallet.id }, data: { balance: { increment: p.net } } });
      const pct = p.price > 0 ? Math.round((p.commission / p.price) * 1000) / 10 : 0;
      // Le livreur voit la livraison entière, puis la commission de l'entreprise débitée
      await tx.transaction.create({
        data: {
          walletId: courierWallet.id,
          type: TransactionType.CREDIT,
          amount: p.price,
          label: p.clientId ? `Gain livraison (${p.dropAddress})` : `Gain livraison destinataire (${p.dropAddress})`,
          labelKey: "TRANSACTION_DELIVERY_EARNING",
          labelParams: { commission: p.commission, pct },
          meta: p.ref,
        },
      });
      if (p.commission > 0) {
        await tx.transaction.create({
          data: {
            walletId: courierWallet.id,
            type: TransactionType.DEBIT,
            amount: p.commission,
            label: `Commission AZƆ̀ (${pct} %)`,
            labelKey: "TRANSACTION_PLATFORM_COMMISSION",
            labelParams: { pct, amount: p.price },
            meta: p.ref,
          },
        });
      }
      const phone = p.phoneCommission ?? 0;
      if (phone > 0) {
        const phonePct = p.price > 0 ? Math.round((phone / p.price) * 1000) / 10 : 0;
        await tx.transaction.create({
          data: {
            walletId: courierWallet.id,
            type: TransactionType.DEBIT,
            amount: phone,
            label: `Commission téléphone (${phonePct} %)`,
            labelKey: "TRANSACTION_PHONE_COMMISSION",
            labelParams: { pct: phonePct, amount: p.price },
            meta: p.ref,
          },
        });
      }
      await this.creditPlatformInTx(tx, p.commission, p.ref);
      await this.creditPlatformInTx(tx, phone, p.ref, "Commission téléphone (à reverser aux boutiques)");
    });
  }

  async debit(userId: string, amount: number, label: string, meta?: string, labelKey?: string, labelParams?: Prisma.InputJsonValue) {
    const wallet = await this.getWallet(userId);
    if (wallet.balance < amount) throw new BadRequestException("Solde insuffisant");
    const [updated] = await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.DEBIT,
          amount,
          label,
          meta,
          ...(labelKey ? { labelKey } : {}),
          ...(labelParams !== undefined ? { labelParams } : {}),
        },
      }),
    ]);
    return updated;
  }

  async chargeMonthlyIndependentZem(period?: string) {
    const targetPeriod = period ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetPeriod)) {
      throw new BadRequestException("La période doit respecter le format AAAA-MM.");
    }
    const [year, month] = targetPeriod.split("-").map(Number);
    const startsAt = new Date(Date.UTC(year, month - 1, 1));
    const endsAt = new Date(Date.UTC(year, month, 1));

    const users = await this.prisma.user.findMany({
      where: {
        agencyId: null,
        provider: {
          is: {
            agencyId: null,
            type: "DRIVER",
            status: "APPROVED",
            vehicleType: { in: ["ZEM_ESSENCE", "ZEM_ELECTRIC", "ZEM_TRICYCLE"] },
          },
        },
      },
      select: {
        id: true,
        wallet: { select: { id: true, balance: true } },
      },
    });
    const wallets = users.flatMap((user) =>
      user.wallet ? [{ ...user.wallet, userId: user.id }] : []
    );
    if (wallets.length === 0) {
      return { period: targetPeriod, charged: 0, outstanding: 0, results: [] };
    }

    const earnings = await this.prisma.transaction.findMany({
      where: {
        walletId: { in: wallets.map((wallet) => wallet.id) },
        type: TransactionType.CREDIT,
        label: "Gain de course",
        createdAt: { gte: startsAt, lt: endsAt },
      },
      select: { walletId: true, amount: true },
    });
    const revenueByWallet = new Map<string, number>();
    for (const earning of earnings) {
      revenueByWallet.set(
        earning.walletId,
        (revenueByWallet.get(earning.walletId) ?? 0) + earning.amount
      );
    }

    const results: Array<{
      userId: string;
      revenue: number;
      amountDue: number;
      status: "charged" | "already_charged" | "insufficient_balance";
    }> = [];
    for (const wallet of wallets) {
      const revenue = revenueByWallet.get(wallet.id) ?? 0;
      const amountDue = this.pricing.monthlyRevenueShare("ZEM_INDEPENDANT", revenue);
      if (amountDue <= 0) continue;

      const meta = `zem-monthly:${targetPeriod}`;
      let outcome:
        | { status: "charged" | "already_charged"; amount: number }
        | { status: "insufficient_balance" };
      let attempts = 0;
      while (true) {
        try {
          outcome = await this.prisma.$transaction(
            async (tx) => {
              const existing = await tx.transaction.findFirst({
                where: {
                  walletId: wallet.id,
                  type: TransactionType.DEBIT,
                  label: { in: MONTHLY_ZEM_SETTLEMENT_LABELS },
                  meta,
                },
                select: { amount: true },
              });
              if (existing) return { status: "already_charged" as const, amount: existing.amount };

              const debit = await tx.wallet.updateMany({
                where: { id: wallet.id, balance: { gte: amountDue } },
                data: { balance: { decrement: amountDue } },
              });
              if (debit.count === 0) return { status: "insufficient_balance" as const };

              await tx.transaction.create({
                data: {
                  walletId: wallet.id,
                  type: TransactionType.DEBIT,
                  amount: amountDue,
                  label: MONTHLY_ZEM_SETTLEMENT_LABEL,
                  labelKey: "TRANSACTION_MONTHLY_ZEM_SETTLEMENT",
                  labelParams: { period: targetPeriod },
                  meta,
                },
              });
              return { status: "charged" as const, amount: amountDue };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
          );
          break;
        } catch (error) {
          const isSerializationConflict =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2034";
          if (!isSerializationConflict || attempts >= 2) throw error;
          attempts += 1;
        }
      }

      results.push({
        userId: wallet.userId,
        revenue,
        amountDue,
        status: outcome.status,
      });
    }

    return {
      period: targetPeriod,
      charged: results
        .filter((result) => result.status === "charged")
        .reduce((total, result) => total + result.amountDue, 0),
      outstanding: results
        .filter((result) => result.status === "insufficient_balance")
        .reduce((total, result) => total + result.amountDue, 0),
      results,
    };
  }

  private async withdrawalRules(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { agency: true, provider: true },
    });
    if (!user) throw new BadRequestException("Compte introuvable");
    const profile =
      user.provider?.type === "COURIER"
       ? "COURSIER"
        : user.provider?.type === "DRIVER" && this.pricing.isZem(user.provider.vehicleType) &&!user.agencyId
         ? "ZEM_INDEPENDANT"
          : null;
    return { profile, agencyLevel: user.agency?.plan?? null } as {
      profile: string | null;
      agencyLevel: string | null;
    };
  }

  async quoteWithdrawal(userId: string, amount: number) {
    const rules = await this.withdrawalRules(userId);
    return this.pricing.withdrawalFeesFor(rules, amount);
  }

  /**
   * Demande de retrait d'un prestataire (Speeder, coursier, agence) vers son compte Mobile Money.
   *
   * Le portefeuille est débité tout de suite (débit conditionnel au solde : deux demandes simultanées ne peuvent pas le
   * rendre négatif) et la demande est enregistrée EN ATTENTE avec le numéro à payer. L'équipe AZƆ̀ verse l'argent depuis la
   * console web puis marque la demande payée ; si elle la refuse, le montant est rendu au portefeuille.
   */
  async withdraw(userId: string, amount: number, payoutPhone: string) {
    if (!Number.isInteger(amount) || amount < MIN_PROVIDER_WITHDRAWAL)
      throw new BadRequestException(`Le retrait minimum est de ${MIN_PROVIDER_WITHDRAWAL.toLocaleString("fr-FR")} FCFA`);
    const local = extractLocalBeninDigits(payoutPhone);
    if (!((local.length === 10 && local.startsWith("01")) || (local.length === 8 && !local.startsWith("01"))))
      throw new BadRequestException("Numéro Mobile Money invalide : 10 chiffres commençant par 01.");
    const phone = normalizeBeninPhone(payoutPhone);
    const quote = await this.quoteWithdrawal(userId, amount);
    if (quote.netAmount <= 0) throw new BadRequestException("Montant trop faible après prélèvement des frais");
    const wallet = await this.getWallet(userId);

    const result = await this.prisma.$transaction(async (tx) => {
      const debit = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
      if (debit.count !== 1) throw new BadRequestException("Solde insuffisant");
      const request = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.DEBIT,
          status: TransactionStatus.PENDING,
          amount,
          label: "Retrait AZƆ̀ Pay",
          labelKey: "TRANSACTION_WITHDRAWAL",
          labelParams: { fee: quote.fee, feePct: quote.feePct, netAmount: quote.netAmount, phone },
          meta: `payout:${phone} · Frais ${quote.feePct} % : ${quote.fee} FCFA · Net à verser : ${quote.netAmount} FCFA`,
        },
      });
      const after = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      return { request, balance: after.balance };
    });

    // Chauffeur rattaché à une agence : la part protégée ne dépasse jamais son solde
    try {
      await this.prisma.$executeRaw`UPDATE "User" SET "agencyProtectedBalance" = LEAST("agencyProtectedBalance", ${result.balance}) WHERE "id" = ${userId} AND "agencyId" IS NOT NULL`;
    } catch {
      // sans effet sur le retrait déjà enregistré
    }
    return { ...quote, balance: result.balance, requestId: result.request.id, payoutPhone: phone, status: "PENDING" as const };
  }

  /** Demandes de retrait des prestataires (console administrateur), les plus récentes d'abord. */
  async listProviderWithdrawals(status?: "PENDING" | "CONFIRMED" | "FAILED") {
    const rows = await this.prisma.transaction.findMany({
      where: {
        type: TransactionType.DEBIT,
        labelKey: { in: ["TRANSACTION_WITHDRAWAL", "TRANSACTION_WITHDRAWAL_REFUSED"] },
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { wallet: { select: { user: { select: { id: true, phone: true, fullName: true, role: true } } } } },
    });
    return rows.map((r) => {
      const params = (r.labelParams ?? {}) as { fee?: number; netAmount?: number; phone?: string };
      const fromMeta = /payout:(\+?\d+)/.exec(r.meta ?? "")?.[1];
      return {
        id: r.id,
        createdAt: r.createdAt,
        status: r.status,
        amount: r.amount,
        fee: params.fee ?? 0,
        netAmount: params.netAmount ?? r.amount,
        payoutPhone: params.phone ?? fromMeta ?? null,
        user: r.wallet.user,
        note: r.meta,
      };
    });
  }

  /** L'argent a été versé sur le Mobile Money du prestataire : la demande passe à « payée ». */
  async markWithdrawalPaid(adminId: string, id: string, reference?: string) {
    const row = await this.prisma.transaction.findUnique({ where: { id }, include: { wallet: { select: { userId: true } } } });
    if (!row || row.labelKey !== "TRANSACTION_WITHDRAWAL") throw new NotFoundException("Demande de retrait introuvable");
    const note = `${row.meta ?? ""} · Payé par ${adminId}${reference ? ` · réf. ${reference.slice(0, 60)}` : ""}`;
    const done = await this.prisma.transaction.updateMany({ where: { id, status: TransactionStatus.PENDING }, data: { status: TransactionStatus.CONFIRMED, meta: note } });
    if (done.count !== 1) throw new BadRequestException("Cette demande a déjà été traitée.");
    const params = (row.labelParams ?? {}) as { netAmount?: number };
    await this.notifications
      ?.push(row.wallet.userId, "Retrait payé ✅", `${(params.netAmount ?? row.amount).toLocaleString("fr-FR")} FCFA ont été versés sur ton compte Mobile Money.`, "payment", {
        sendPush: true,
        data: { event: "withdrawal-paid", amount: params.netAmount ?? row.amount },
      })
      .catch(() => null);
    return { id, status: "CONFIRMED" as const };
  }

  /** Demande refusée : le montant est rendu au portefeuille du prestataire (une seule fois) et il est prévenu. */
  async rejectWithdrawal(adminId: string, id: string, reason: string) {
    const row = await this.prisma.transaction.findUnique({ where: { id }, include: { wallet: { select: { id: true, userId: true } } } });
    if (!row || row.labelKey !== "TRANSACTION_WITHDRAWAL") throw new NotFoundException("Demande de retrait introuvable");
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.transaction.updateMany({
        where: { id, status: TransactionStatus.PENDING },
        data: { status: TransactionStatus.FAILED, labelKey: "TRANSACTION_WITHDRAWAL_REFUSED", label: "Retrait refusé", meta: `${row.meta ?? ""} · Refusé par ${adminId} : ${reason.slice(0, 200)}` },
      });
      if (done.count !== 1) throw new BadRequestException("Cette demande a déjà été traitée.");
      await tx.wallet.update({ where: { id: row.wallet.id }, data: { balance: { increment: row.amount } } });
      await tx.transaction.create({
        data: {
          walletId: row.wallet.id,
          type: TransactionType.CREDIT,
          amount: row.amount,
          label: "Retrait refusé : montant rendu",
          meta: `Remboursement du retrait ${id}`,
        },
      });
    });
    await this.notifications
      ?.push(row.wallet.userId, "Retrait refusé", `Ta demande de retrait n'a pas pu être payée (${reason.slice(0, 120)}). ${row.amount.toLocaleString("fr-FR")} FCFA ont été rendus à ton portefeuille.`, "payment", {
        sendPush: true,
        data: { event: "withdrawal-refused", amount: row.amount },
      })
      .catch(() => null);
    return { id, status: "FAILED" as const };
  }
}
