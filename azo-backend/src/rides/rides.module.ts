import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RidesController } from "./rides.controller";
import { RidesService } from "./rides.service";
import { RidesGateway } from "./rides.gateway";

@Module({
  imports: [WalletModule, NotificationsModule],
  controllers: [RidesController],
  providers: [RidesService, RidesGateway],
  exports: [RidesService],
})
export class RidesModule {}
