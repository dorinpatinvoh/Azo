import { PlacesModule } from "./places/places.module";
import { SavedPlacesModule } from "./places/saved-places.module";
import { SupportModule } from "./support/support.module";
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
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
import { ProvidersModule } from "./providers/providers.module";
import { PricingModule } from "./pricing/pricing.module";
import { HealthController } from "./health.controller";
import { RegistrationModule } from "./common/registration.module";
import { LanguageMiddleware } from "./common/language.middleware";

@Module({
  imports: [
    PrismaModule,
    RegistrationModule,
    AuthModule,
    UsersModule,
    RidesModule,
    PlacesModule,
    SavedPlacesModule,
    SupportModule,
    WalletModule,
    DeliveryModule,
    RentalModule,
    MarketplaceModule,
    ArtisansModule,
    AgenciesModule,
    AdminModule,
    NotificationsModule,
    ProvidersModule,
    PricingModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Applique la résolution de langue (Accept-Language) sur toutes les routes.
    consumer.apply(LanguageMiddleware).forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
