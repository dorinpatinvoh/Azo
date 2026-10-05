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
const pricing_module_1 = require("../pricing/pricing.module");
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
class WithdrawDto {
}
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], WithdrawDto.prototype, "amount", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WithdrawDto.prototype, "context", void 0);
let WalletService = class WalletService {
    constructor(prisma, pricing) {
        this.prisma = prisma;
        this.pricing = pricing;
    }
    async getWallet(userId) {
        let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
        if (!wallet) {
            wallet = await this.prisma.wallet.create({ data: { userId } });
        }
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
    // Transfert atomique : le client est débité et le chauffeur crédité dans LA MÊME
    // transaction. Si le solde est insuffisant, rien ne bouge (aucun débit orphelin).
    async transfer(fromUserId, toUserId, debitAmount, creditAmount, fromLabel, toLabel, meta) {
        const from = await this.getWallet(fromUserId);
        if (from.balance < debitAmount)
            throw new common_1.BadRequestException("Solde insuffisant");
        const to = await this.getWallet(toUserId);
        await this.prisma.$transaction([
            this.prisma.wallet.update({ where: { id: from.id }, data: { balance: { decrement: debitAmount } } }),
            this.prisma.transaction.create({ data: { walletId: from.id, type: "DEBIT", amount: debitAmount, label: fromLabel, meta } }),
            this.prisma.wallet.update({ where: { id: to.id }, data: { balance: { increment: creditAmount } } }),
            this.prisma.transaction.create({ data: { walletId: to.id, type: "CREDIT", amount: creditAmount, label: toLabel, meta } }),
        ]);
        return { debited: debitAmount, credited: creditAmount };
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
    /* ------------------------------------------------------------------ Retraits */
    /**
     * Frais de retrait applicables à un compte, selon les règles configurées :
     * profil (ZEM_INDEPENDANT → 1,5 %) puis niveau d'agence (PRO 1 % … DIAMANT 0,25 %).
     */
    async withdrawalRules(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { agency: true, provider: true },
        });
        if (!user)
            throw new common_1.BadRequestException("Compte introuvable");
        const gamme = user.provider?.vehicleType
            ? this.pricing.resolveGamme(user.provider.vehicleType)
            : null;
        const profile = user.provider?.type === "COURIER"
            ? "COURSIER"
            : user.provider?.type === "DRIVER" && gamme === "GAZELLE" && !user.agencyId
                ? "ZEM_INDEPENDANT"
                : null;
        return { profile, agencyLevel: user.agency?.plan ?? null };
    }
    /** Aperçu (sans mouvement) des frais de retrait pour un montant donné. */
    async quoteWithdrawal(userId, amount) {
        const rules = await this.withdrawalRules(userId);
        return this.pricing.withdrawalFeesFor(rules, amount);
    }
    /**
     * Retrait : les frais du profil ou du niveau d'agence sont prélevés sur le montant
     * demandé, le solde est débité du montant et le compte crédité du net.
     */
    async withdraw(userId, amount) {
        const quote = await this.quoteWithdrawal(userId, amount);
        if (quote.netAmount <= 0)
            throw new common_1.BadRequestException("Montant trop faible après prélèvement des frais");
        const wallet = await this.getWallet(userId);
        if (wallet.balance < amount)
            throw new common_1.BadRequestException("Solde insuffisant");
        const [updated] = await this.prisma.$transaction([
            this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } }),
            this.prisma.transaction.create({
                data: {
                    walletId: wallet.id,
                    type: "DEBIT",
                    amount,
                    label: "Retrait AZƆ̀ Pay",
                    meta: `Frais ${quote.feePct} % : ${quote.fee} FCFA · Net versé : ${quote.netAmount} FCFA`,
                },
            }),
        ]);
        return { ...quote, balance: updated.balance };
    }
    /* ------------------------------------------------- Prélèvement mensuel des Zem */
    /**
     * Prélèvement mensuel des Zem indépendants : 15 % des revenus du mois (jamais par
     * course). Idempotent : un mois déjà prélevé n'est pas repris.
     */
    async chargeMonthlyIndependentZem(period) {
        const key = period ?? new Date().toISOString().slice(0, 7); // "AAAA-MM"
        const [year, month] = key.split("-").map((n) => Number(n));
        if (!year || !month)
            throw new common_1.BadRequestException("Période attendue au format AAAA-MM");
        const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
        const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
        const label = `Prélèvement mensuel AZƆ̀ (Zem indépendant) — ${key}`;
        const drivers = await this.prisma.user.findMany({
            where: { provider: { type: "DRIVER", status: "APPROVED" }, agencyId: null },
            include: { provider: true },
        });
        const charged = [];
        for (const driver of drivers) {
            const gamme = driver.provider?.vehicleType
                ? this.pricing.resolveGamme(driver.provider.vehicleType)
                : null;
            if (gamme !== "GAZELLE")
                continue; // seuls les Zem indépendants sont prélevés
            const wallet = await this.getWallet(driver.id);
            const already = await this.prisma.transaction.findFirst({
                where: { walletId: wallet.id, label },
                select: { id: true },
            });
            if (already)
                continue; // mois déjà traité : on ne prélève pas deux fois
            const gains = await this.prisma.transaction.findMany({
                where: {
                    walletId: wallet.id,
                    type: "CREDIT",
                    label: "Gain de course",
                    createdAt: { gte: start, lt: end },
                },
                select: { amount: true },
            });
            const revenue = gains.reduce((sum, g) => sum + g.amount, 0);
            const share = this.pricing.monthlyRevenueShare("ZEM_INDEPENDANT", revenue);
            if (share > 0) {
                await this.prisma.wallet.update({
                    where: { id: wallet.id },
                    data: { balance: { decrement: share } },
                });
                await this.prisma.transaction.create({
                    data: {
                        walletId: wallet.id,
                        type: "DEBIT",
                        amount: share,
                        label,
                        meta: `${this.pricing.getConfig().profiles.ZEM_INDEPENDANT.monthlyRevenueSharePct} % de ${revenue} FCFA de revenus`,
                    },
                });
            }
            charged.push({ userId: driver.id, period: key, revenue, share });
        }
        return { period: key, sharePct: this.pricing.getConfig().profiles.ZEM_INDEPENDANT.monthlyRevenueSharePct, charged };
    }
};
exports.WalletService = WalletService;
exports.WalletService = WalletService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, pricing_module_1.PricingService])
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
    // GET /wallet/withdrawal-quote?amount=50000 — frais de retrait avant confirmation
    // (profil Zem indépendant 1,5 % ; niveau d'agence PRO 1 % … DIAMANT 0,25 %).
    withdrawalQuote(user, amount) {
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0)
            throw new common_1.BadRequestException("Montant invalide");
        return this.wallet.quoteWithdrawal(user.userId, Math.floor(value));
    }
    // POST /wallet/withdraw  { "amount": 50000 }
    withdraw(user, dto) {
        return this.wallet.withdraw(user.userId, dto.amount);
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
__decorate([
    (0, common_1.Get)("withdrawal-quote"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("amount")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "withdrawalQuote", null);
__decorate([
    (0, common_1.Post)("withdraw"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, WithdrawDto]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "withdraw", null);
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
        imports: [pricing_module_1.PricingModule],
        controllers: [WalletController],
        providers: [WalletService],
        exports: [WalletService],
    })
], WalletModule);
//# sourceMappingURL=wallet.module.js.map