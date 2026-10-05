"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const places_module_1 = require("./places/places.module");
const common_1 = require("@nestjs/common");
const prisma_module_1 = require("./prisma/prisma.module");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const rides_module_1 = require("./rides/rides.module");
const wallet_module_1 = require("./wallet/wallet.module");
const delivery_module_1 = require("./delivery/delivery.module");
const rental_module_1 = require("./rental/rental.module");
const marketplace_module_1 = require("./marketplace/marketplace.module");
const artisans_module_1 = require("./artisans/artisans.module");
const agencies_module_1 = require("./agencies/agencies.module");
const admin_module_1 = require("./admin/admin.module");
const notifications_module_1 = require("./notifications/notifications.module");
const providers_module_1 = require("./providers/providers.module");
const pricing_module_1 = require("./pricing/pricing.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            rides_module_1.RidesModule,
            places_module_1.PlacesModule,
            wallet_module_1.WalletModule,
            delivery_module_1.DeliveryModule,
            rental_module_1.RentalModule,
            marketplace_module_1.MarketplaceModule,
            artisans_module_1.ArtisansModule,
            agencies_module_1.AgenciesModule,
            admin_module_1.AdminModule,
            notifications_module_1.NotificationsModule,
            providers_module_1.ProvidersModule,
            pricing_module_1.PricingModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map