"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketplaceModule = exports.MarketplaceController = exports.MarketplaceService = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const prisma_service_1 = require("../prisma/prisma.service");
const wallet_module_1 = require("../wallet/wallet.module");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
class OrderDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], OrderDto.prototype, "market", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], OrderDto.prototype, "items", void 0);
let MarketplaceService = class MarketplaceService {
    constructor(prisma, wallet) {
        this.prisma = prisma;
        this.wallet = wallet;
    }
    // Séquestre : l'argent est débité du client et bloqué jusqu'à validation
    async order(clientId, dto) {
        const total = dto.items.reduce((s, i) => s + i.price, 0);
        await this.wallet.debit(clientId, total, "Séquestre courses marché", dto.market);
        return this.prisma.marketplaceOrder.create({
            data: { clientId, market: dto.market, items: dto.items, total, status: "escrowed" },
        });
    }
    // Le client valide la livraison -> le séquestre est libéré (à répartir coursier/vendeurs)
    async validate(orderId, clientId) {
        const o = await this.prisma.marketplaceOrder.findUnique({ where: { id: orderId } });
        if (!o || o.clientId !== clientId)
            throw new common_1.BadRequestException("Commande introuvable");
        return this.prisma.marketplaceOrder.update({ where: { id: orderId }, data: { status: "delivered" } });
    }
};
exports.MarketplaceService = MarketplaceService;
exports.MarketplaceService = MarketplaceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, wallet_module_1.WalletService])
], MarketplaceService);
let MarketplaceController = class MarketplaceController {
    constructor(svc) {
        this.svc = svc;
    }
    order(u, dto) { return this.svc.order(u.userId, dto); }
    validate(id, u) { return this.svc.validate(id, u.userId); }
};
exports.MarketplaceController = MarketplaceController;
__decorate([
    (0, common_1.Post)("orders"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, OrderDto]),
    __metadata("design:returntype", void 0)
], MarketplaceController.prototype, "order", null);
__decorate([
    (0, common_1.Post)("orders/:id/validate"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], MarketplaceController.prototype, "validate", null);
exports.MarketplaceController = MarketplaceController = __decorate([
    (0, common_1.Controller)("marketplace"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [MarketplaceService])
], MarketplaceController);
let MarketplaceModule = class MarketplaceModule {
};
exports.MarketplaceModule = MarketplaceModule;
exports.MarketplaceModule = MarketplaceModule = __decorate([
    (0, common_1.Module)({ imports: [wallet_module_1.WalletModule], controllers: [MarketplaceController], providers: [MarketplaceService] })
], MarketplaceModule);
//# sourceMappingURL=marketplace.module.js.map