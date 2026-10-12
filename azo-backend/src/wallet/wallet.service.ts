import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.service";
import { FedaPayService } from "./fedapay.service";
import { TransactionType } from "@prisma/client";

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