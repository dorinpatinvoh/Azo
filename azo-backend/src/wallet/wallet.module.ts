import { Module } from "@nestjs/common";
import { WalletService } from "./wallet.service";
import { WalletController } from "./wallet.controller";
import { FedaPayService } from "./fedapay.service";
import { PricingModule } from "../pricing/pricing.module";

export { WalletService } from "./wallet.service";

@Module({
  imports: [PricingModule],
  controllers: [WalletController],
  providers: [WalletService, FedaPayService],
  exports: [WalletService],
})
export class WalletModule {}