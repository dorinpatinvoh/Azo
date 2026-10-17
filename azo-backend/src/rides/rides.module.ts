import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PricingModule } from "../pricing/pricing.module";
import { RidesController } from "./rides.controller";
import { RidesService } from "./rides.service";
import { RidesGateway } from "./rides.gateway";
import { RideSettlementController, RideSettlementService } from "./ride-settlement.service";
import { RidesOfferExpiryTask } from "./rides-offer-expiry.task";
import { ScheduledRidesTask } from "./scheduled-rides.task";
import { TipsService } from "./tips.service";
import { RideExtrasService } from "./ride-extras.service";
import { MessagesService } from "./messages.service";
import { MessagesController } from "./messages.controller";

@Module({
  imports: [WalletModule, NotificationsModule, PricingModule],
  controllers: [RidesController, RideSettlementController, MessagesController],
  providers: [RidesService, RidesGateway, RideSettlementService, RidesOfferExpiryTask, ScheduledRidesTask, TipsService, MessagesService, RideExtrasService],
  exports: [RidesService, MessagesService, RidesGateway],
})
export class RidesModule {}
