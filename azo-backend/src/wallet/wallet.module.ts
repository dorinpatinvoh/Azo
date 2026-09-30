import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, UseGuards } from "@nestjs/common";
import { IsInt, IsString, Min } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

class RechargeDto {
  @IsInt() @Min(100) amount: number;
  @IsString() method: string; // "MTN_MOMO" | "MOOV" | "CARD"
}

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new BadRequestException("Portefeuille introuvable");
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
}

@Module({
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
