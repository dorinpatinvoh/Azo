import { Module } from "@nestjs/common";
import { WalletService } from "./wallet.service";
import { WalletController } from "./wallet.controller";
import { FedaPayService } from "./fedapay.service";
import { PricingModule } from "../pricing/pricing.module";

@Module({
  imports: [PricingModule],
  controllers: [WalletController],
  providers: [WalletService, FedaPayService],
  exports: [WalletService, FedaPayService],
})
export class WalletModule {}