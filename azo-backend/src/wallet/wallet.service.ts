import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.service";
import { FedaPayService } from "./fedapay.service";
import { Prisma, TransactionType } from "@prisma/client";

const MONTHLY_ZEM_SETTLEMENT_LABEL = "Prélèvement mensuel Zem";

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private fedaPay: FedaPayService,
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

  async initRecharge(userId: string, amount: number, email: string) {
    const { transaction, token } = await this.fedaPay.createTransaction(
      amount,
      email,
      `Recharge AZO ${amount} FCFA`,
    );
    const wallet = await this.getWallet(userId);
    await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.DEBIT,
        amount,
        label: "Recharge en attente FedaPay",
        meta: `fedaPayId:${transaction.id}`,
      },
    });
    return { url: token.url, transactionId: transaction.id };
  }

  async credit(userId: string, amount: number, label: string, meta?: string) {
    const wallet = await this.getWallet(userId);
    const [updated] = await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } }),
      this.prisma.transaction.create({ data: { walletId: wallet.id, type: TransactionType.CREDIT, amount, label, meta } }),
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

  async debit(userId: string, amount: number, label: string, meta?: string) {
    const wallet = await this.getWallet(userId);
    if (wallet.balance < amount) throw new BadRequestException("Solde insuffisant");
    const [updated] = await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } }),
      this.prisma.transaction.create({ data: { walletId: wallet.id, type: TransactionType.DEBIT, amount, label, meta } }),
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
          meta: `Frais ${quote.feePct} % : ${quote.fee} FCFA · Net versé : ${quote.netAmount} FCFA`,
        },
      }),
    ]);
    return {...quote, balance: updated.balance };
  }
}