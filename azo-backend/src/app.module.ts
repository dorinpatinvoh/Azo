import { PlacesModule } from "./places/places.module";
import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { RidesModule } from "./rides/rides.module";
import { WalletModule } from "./wallet/wallet.module";
import { DeliveryModule } from "./delivery/delivery.module";
import { RentalModule } from "./rental/rental.module";
import { MarketplaceModule } from "./marketplace/marketplace.module";
import { ArtisansModule } from "./artisans/artisans.module";
import { AgenciesModule } from "./agencies/agencies.module";
import { AdminModule } from "./admin/admin.module";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    RidesModule,
    PlacesModule,
    WalletModule,
    DeliveryModule,
    RentalModule,
    MarketplaceModule,
    ArtisansModule,
    AgenciesModule,
    AdminModule,
    NotificationsModule,
  ],
})
export class AppModule {}
