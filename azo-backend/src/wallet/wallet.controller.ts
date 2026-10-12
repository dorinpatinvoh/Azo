import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Min } from "class-validator";
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