import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Query,
  Injectable,
  Module,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsInt, IsOptional, IsString, Min } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PricingModule, PricingService } from "../pricing/pricing.module";

class RechargeDto {
  @IsInt() @Min(100) amount: number;
  @IsString() method: string; // "MTN_MOMO" | "MOOV" | "CARD"
}

class WithdrawDto {
  @IsInt() @Min(1) amount: number;
  /** Exploitant d'agence : le retrait porte sur le portefeuille de la flotte. */
  @IsOptional() @IsString() context?: "AGENCY";
}

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService, private pricing: PricingService) {}

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

  // Crédite le portefeuille (recharge, gain de course, remboursement...)
  async credit(userId: string, amount: number, label: string, meta?: string) {
    const wallet = await this.getWallet(userId);
    const [updated] = await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } }),
      this.prisma.transaction.create({ data: { walletId: wallet.id, type: "CREDIT", amount, label, meta } }),
    ]);
    return updated;
  }

  // Transfert atomique : le client est débité et le chauffeur crédité dans LA MÊME
  // transaction. Si le solde est insuffisant, rien ne bouge (aucun débit orphelin).
  async transfer(
    fromUserId: string,
    toUserId: string,
    debitAmount: number,
    creditAmount: number,
    fromLabel: string,
    toLabel: string,
    meta?: string
  ) {
    const from = await this.getWallet(fromUserId);
    if (from.balance < debitAmount) throw new BadRequestException("Solde insuffisant");
    const to = await this.getWallet(toUserId);

    await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: from.id }, data: { balance: { decrement: debitAmount } } }),
      this.prisma.transaction.create({ data: { walletId: from.id, type: "DEBIT", amount: debitAmount, label: fromLabel, meta } }),
      this.prisma.wallet.update({ where: { id: to.id }, data: { balance: { increment: creditAmount } } }),
      this.prisma.transaction.create({ data: { walletId: to.id, type: "CREDIT", amount: creditAmount, label: toLabel, meta } }),
    ]);

    return { debited: debitAmount, credited: creditAmount };
  }

  // Débite le portefeuille — refuse si le solde est insuffisant
  async debit(userId: string, amount: number, label: string, meta?: string) {
    const wallet = await this.getWallet(userId);
    if (wallet.balance < amount) throw new BadRequestException("Solde insuffisant");
    const [updated] = await this.prisma.$transaction([
      this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } }),
      this.prisma.transaction.create({ data: { walletId: wallet.id, type: "DEBIT", amount, label, meta } }),
    ]);
    return updated;
  }

  /* ------------------------------------------------------------------ Retraits */

  /**
   * Frais de retrait applicables à un compte, selon les règles configurées :
   * profil (ZEM_INDEPENDANT → 1,5 %) puis niveau d'agence (PRO 1 % … DIAMANT 0,25 %).
   */
  private async withdrawalRules(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { agency: true, provider: true },
    });
    if (!user) throw new BadRequestException("Compte introuvable");

    const profile =
      user.provider?.type === "COURIER"
        ? "COURSIER"
        : user.provider?.type === "DRIVER" && this.pricing.isZem(user.provider.vehicleType) && !user.agencyId
          ? "ZEM_INDEPENDANT"
          : null;

    return { profile, agencyLevel: user.agency?.plan ?? null } as {
      profile: string | null;
      agencyLevel: string | null;
    };
  }

  /** Aperçu (sans mouvement) des frais de retrait pour un montant donné. */
  async quoteWithdrawal(userId: string, amount: number) {
    const rules = await this.withdrawalRules(userId);
    return this.pricing.withdrawalFeesFor(rules, amount);
  }

  /**
   * Retrait : les frais du profil ou du niveau d'agence sont prélevés sur le montant
   * demandé, le solde est débité du montant et le compte crédité du net.
   */
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
          type: "DEBIT",
          amount,
          label: "Retrait AZƆ̀ Pay",
          meta: `Frais ${quote.feePct} % : ${quote.fee} FCFA · Net versé : ${quote.netAmount} FCFA`,
        },
      }),
    ]);

    return { ...quote, balance: updated.balance };
  }

  /* ------------------------------------------------- Prélèvement mensuel des Zem */

  /**
   * Prélèvement mensuel des Zem indépendants : 15 % des revenus du mois (jamais par
   * course). Idempotent : un mois déjà prélevé n'est pas repris.
   */
  async chargeMonthlyIndependentZem(period?: string) {
    const key = period ?? new Date().toISOString().slice(0, 7); // "AAAA-MM"
    const [year, month] = key.split("-").map((n) => Number(n));
    if (!year || !month) throw new BadRequestException("Période attendue au format AAAA-MM");

    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const label = `Prélèvement mensuel AZƆ̀ (Zem indépendant) — ${key}`;

    const drivers = await this.prisma.user.findMany({
      where: { provider: { type: "DRIVER", status: "APPROVED" }, agencyId: null },
      include: { provider: true },
    });

    const charged: { userId: string; period: string; revenue: number; share: number }[] = [];

    for (const driver of drivers) {
      // Seuls les Zem indépendants (moto-taxi essence ou électrique) sont prélevés.
      if (!this.pricing.isZem(driver.provider?.vehicleType)) continue;

      const wallet = await this.getWallet(driver.id);
      const already = await this.prisma.transaction.findFirst({
        where: { walletId: wallet.id, label },
        select: { id: true },
      });
      if (already) continue; // mois déjà traité : on ne prélève pas deux fois

      const gains = await this.prisma.transaction.findMany({
        where: {
          walletId: wallet.id,
          type: "CREDIT",
          label: "Gain de course",
          createdAt: { gte: start, lt: end },
        },
        select: { amount: true },
      });
      const revenue = gains.reduce((sum, g) => sum + g.amount, 0);
      const share = this.pricing.monthlyRevenueShare("ZEM_INDEPENDANT", revenue);

      if (share > 0) {
        await this.prisma.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: share } },
        });
        await this.prisma.transaction.create({
          data: {
            walletId: wallet.id,
            type: "DEBIT",
            amount: share,
            label,
            meta: `${this.pricing.getConfig().profiles.ZEM_INDEPENDANT.monthlyRevenueSharePct} % de ${revenue} FCFA de revenus`,
          },
        });
      }
      charged.push({ userId: driver.id, period: key, revenue, share });
    }

    return { period: key, sharePct: this.pricing.getConfig().profiles.ZEM_INDEPENDANT.monthlyRevenueSharePct, charged };
  }
}

@Controller("wallet")
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private wallet: WalletService) {}

  // GET /wallet
  @Get()
  get(@CurrentUser() user) {
    return this.wallet.getWallet(user.userId);
  }

  // GET /wallet/transactions
  @Get("transactions")
  transactions(@CurrentUser() user) {
    return this.wallet.transactions(user.userId);
  }

  // POST /wallet/recharge  { "amount": 10000, "method": "MTN_MOMO" }
  // ⚠️ Simulation : en production, appeler l'API FedaPay/CinetPay et ne créditer
  // qu'après confirmation du paiement par webhook.
  @Post("recharge")
  recharge(@CurrentUser() user, @Body() dto: RechargeDto) {
    return this.wallet.credit(user.userId, dto.amount, `Rechargement ${dto.method}`, "Simulation");
  }

  // GET /wallet/withdrawal-quote?amount=50000 — frais de retrait avant confirmation
  // (profil Zem indépendant 1,5 % ; niveau d'agence PRO 1 % … DIAMANT 0,25 %).
  @Get("withdrawal-quote")
  withdrawalQuote(@CurrentUser() user, @Query("amount") amount: string) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new BadRequestException("Montant invalide");
    return this.wallet.quoteWithdrawal(user.userId, Math.floor(value));
  }

  // POST /wallet/withdraw  { "amount": 50000 }
  @Post("withdraw")
  withdraw(@CurrentUser() user, @Body() dto: WithdrawDto) {
    return this.wallet.withdraw(user.userId, dto.amount);
  }
}

@Module({
  imports: [PricingModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
