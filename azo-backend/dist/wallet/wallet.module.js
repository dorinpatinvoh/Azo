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
exports.WalletModule = exports.WalletController = exports.WalletService = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
class RechargeDto {
}
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(100),
    __metadata("design:type", Number)
], RechargeDto.prototype, "amount", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RechargeDto.prototype, "method", void 0);
let WalletService = class WalletService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getWallet(userId) {
        const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
        if (!wallet)
            throw new common_1.BadRequestException("Portefeuille introuvable");
        return wallet;
    }
    async transactions(userId) {
        const wallet = await this.getWallet(userId);
        return this.prisma.transaction.findMany({
            where: { walletId: wallet.id },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
    }
    // Crédite le portefeuille (recharge, gain de course, remboursement...)
    async credit(userId, amount, label, meta) {
        const wallet = await this.getWallet(userId);
        const [updated] = await this.prisma.$transaction([
            this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } }),
            this.prisma.transaction.create({ data: { walletId: wallet.id, type: "CREDIT", amount, label, meta } }),
        ]);
        return updated;
    }
    // Débite le portefeuille — refuse si le solde est insuffisant
    async debit(userId, amount, label, meta) {
        const wallet = await this.getWallet(userId);
        if (wallet.balance < amount)
            throw new common_1.BadRequestException("Solde insuffisant");
        const [updated] = await this.prisma.$transaction([
            this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } }),
            this.prisma.transaction.create({ data: { walletId: wallet.id, type: "DEBIT", amount, label, meta } }),
        ]);
        return updated;
    }
};
exports.WalletService = WalletService;
exports.WalletService = WalletService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], WalletService);
let WalletController = class WalletController {
    constructor(wallet) {
        this.wallet = wallet;
    }
    // GET /wallet
    get(user) {
        return this.wallet.getWallet(user.userId);
    }
    // GET /wallet/transactions
    transactions(user) {
        return this.wallet.transactions(user.userId);
    }
    // POST /wallet/recharge  { "amount": 10000, "method": "MTN_MOMO" }
    // ⚠️ Simulation : en production, appeler l'API FedaPay/CinetPay et ne créditer
    // qu'après confirmation du paiement par webhook.
    recharge(user, dto) {
        return this.wallet.credit(user.userId, dto.amount, `Rechargement ${dto.method}`, "Simulation");
    }
};
exports.WalletController = WalletController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "get", null);
__decorate([
    (0, common_1.Get)("transactions"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "transactions", null);
__decorate([
    (0, common_1.Post)("recharge"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, RechargeDto]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "recharge", null);
exports.WalletController = WalletController = __decorate([
    (0, common_1.Controller)("wallet"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [WalletService])
], WalletController);
let WalletModule = class WalletModule {
};
exports.WalletModule = WalletModule;
exports.WalletModule = WalletModule = __decorate([
    (0, common_1.Module)({
        controllers: [WalletController],
        providers: [WalletService],
        exports: [WalletService],
    })
], WalletModule);
//# sourceMappingURL=wallet.module.js.map