import { NotificationsModule } from "../notifications/notifications.module";
import { Module } from "@nestjs/common";
import { WalletService } from "./wallet.service";
import { WalletController, FedaPayCallbackController } from "./wallet.controller";
import { FedaPayService } from "./fedapay.service";
import { PricingModule } from "../pricing/pricing.module";

export { WalletService } from "./wallet.service";

@Module({
  imports: [PricingModule, NotificationsModule],
  controllers: [WalletController, FedaPayCallbackController],
  providers: [WalletService, FedaPayService],
  exports: [WalletService],
})
export class WalletModule {}