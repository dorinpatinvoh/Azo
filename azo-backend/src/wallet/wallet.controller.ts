import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Post, Query, UseGuards } from "@nestjs/common";
import { IsInt, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RegistrationCompleteGuard } from "../common/guards/registration-complete.guard";
import { WalletService } from "./wallet.service";

class RechargeDto {
  @IsInt() @Min(100) amount: number;
  @IsString() method: string;
}

class WithdrawDto {
  @IsInt() @Min(1) amount: number;
  @IsOptional() @IsString() context?: "AGENCY";
}

/**
 * Corps du webhook FedaPay (événement transaction.approved / transaction.declined).
 * FedaPay envoie un POST sur FEDAPAY_CALLBACK_URL avec l'identifiant de la transaction.
 */
class FedaPayCallbackDto {
  @IsNumber() id: number;
}

@Controller("wallet")
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Get()
  get(@CurrentUser() user) {
    return this.wallet.getWallet(user.userId);
  }

  @Get("transactions")
  transactions(@CurrentUser() user) {
    return this.wallet.transactions(user.userId);
  }

  @Post("recharge")
  @UseGuards(RegistrationCompleteGuard)
  recharge(@CurrentUser() user, @Body() dto: RechargeDto) {
    // `user.email` peut être undefined si l'utilisateur s'est inscrit par téléphone.
    // initRecharge gère le repli vers une adresse fictive.
    return this.wallet.initRecharge(user.userId, dto.amount, user.email);
  }

  @Get("withdrawal-quote")
  withdrawalQuote(@CurrentUser() user, @Query("amount") amount: string) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new BadRequestException("Montant invalide");
    return this.wallet.quoteWithdrawal(user.userId, Math.floor(value));
  }

  @Post("withdraw")
  @UseGuards(RegistrationCompleteGuard)
  withdraw(@CurrentUser() user, @Body() dto: WithdrawDto) {
    return this.wallet.withdraw(user.userId, dto.amount);
  }
}

/**
 * Contrôleur public pour les webhooks FedaPay.
 * Volontairement séparé de WalletController pour ne PAS hériter du JwtAuthGuard.
 *
 * POST /wallet/recharge/callback
 * En production, sécuriser avec la signature HMAC que FedaPay ajoute dans les headers
 * (X-FedaPay-Signature) ou restreindre les IP source FedaPay au niveau du reverse proxy.
 */
@Controller("wallet/recharge")
export class FedaPayCallbackController {
  private readonly logger = new Logger(FedaPayCallbackController.name);

  constructor(private wallet: WalletService) {}

  @Post("callback")
  @HttpCode(200)
  async fedaPayCallback(@Body() dto: FedaPayCallbackDto) {
    try {
      const result = await this.wallet.handleFedaPayCallback(dto.id);
      return result;
    } catch (error) {
      // On absorbe les erreurs : FedaPay réémettra l'événement si on ne répond pas 200.
      this.logger.warn(
        `FedaPay callback error for transaction ${dto.id}: ${error instanceof Error ? error.message : String(error)}`
      );
      return { credited: false, reason: "error" };
    }
  }
}