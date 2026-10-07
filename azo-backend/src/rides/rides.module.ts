import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PricingModule } from "../pricing/pricing.module";
import { RidesController } from "./rides.controller";
import { RidesService } from "./rides.service";
import { RidesGateway } from "./rides.gateway";
import { RideSettlementController, RideSettlementService } from "./ride-settlement.service";

@Module({
  imports: [WalletModule, NotificationsModule, PricingModule],
  controllers: [RidesController, RideSettlementController],
  providers: [RidesService, RidesGateway, RideSettlementService],
  exports: [RidesService],
})
export class RidesModule {}
