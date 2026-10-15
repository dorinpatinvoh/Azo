import { NotificationsService } from "../notifications/notifications.module";
import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.service";
import { FedaPayService } from "./fedapay.service";
import { Prisma, TransactionStatus, TransactionType } from "@prisma/client";

const MONTHLY_ZEM_SETTLEMENT_LABEL = "Prélèvement mensuel Zem";

/** Recharge minimale par FedaPay (FCFA). Le mobile applique la même valeur (config/wallet.ts). */
export const MIN_RECHARGE = 300;

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

    const { transaction, token } = await this.fedaPay.createTransaction(
      amount,
      safeEmail,
      `Recharge AZO ${amount} FCFA`,
    );
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
            vehicleType: { in: ["ZEM_ESSENCE", "ZEM_ELECTRIC"] },
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
                  label: MONTHLY_ZEM_SETTLEMENT_LABEL,
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

  async withdraw(userId: string, amount: number) {
    const quote = await this.quoteWithdrawal(userId, amount);
    if (quote.netAmount <= 0) throw new BadRequestException("Montant trop faible après prélèvement des frais");
    const wallet = await this.getWallet(userId);
    if (wallet.balance < amount) throw new BadRequestException("Solde insuffisant");
    const [updated] = await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.DEBIT,
          amount,
          label: "Retrait AZƆ̀ Pay",
          labelKey: "TRANSACTION_WITHDRAWAL",
          labelParams: { fee: quote.fee, feePct: quote.feePct, netAmount: quote.netAmount },
          meta: `Frais ${quote.feePct} % : ${quote.fee} FCFA · Net versé : ${quote.netAmount} FCFA`,
        },
      }),
    ]);
    return {...quote, balance: updated.balance };
  }
}