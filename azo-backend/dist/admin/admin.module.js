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
exports.AdminModule = exports.AdminController = exports.AdminService = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const wallet_module_1 = require("../wallet/wallet.module");
const pricing_module_1 = require("../pricing/pricing.module");
class MonthlySettlementDto {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(7),
    __metadata("design:type", String)
], MonthlySettlementDto.prototype, "period", void 0);
class UpdateUserStatusDto {
}
__decorate([
    (0, class_validator_1.IsIn)(["ACTIVE", "BLOCKED"]),
    __metadata("design:type", String)
], UpdateUserStatusDto.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], UpdateUserStatusDto.prototype, "reason", void 0);
let AdminService = class AdminService {
    constructor(prisma, wallet, pricing) {
        this.prisma = prisma;
        this.wallet = wallet;
        this.pricing = pricing;
    }
    // Prélèvement mensuel des Zem indépendants (15 % des revenus du mois), délégué au
    // portefeuille pour rester idempotent et auditable.
    chargeZemMonthly(period) {
        return this.wallet.chargeMonthlyIndependentZem(period);
    }
    // Indicateurs globaux de l'écran "Tableau de bord administrateur"
    async stats() {
        const [users, rides, completedRides, deliveries, completedDeliveries, agencies, providersPending, providersApproved, blockedUsers,] = await Promise.all([
            this.prisma.user.count(),
            this.prisma.ride.count(),
            this.prisma.ride.findMany({ where: { status: "COMPLETED" }, select: { commission: true, price: true } }),
            this.prisma.delivery.count(),
            this.prisma.delivery.findMany({ where: { status: "COMPLETED" }, select: { price: true } }),
            this.prisma.agency.count(),
            this.prisma.providerProfile.count({
                where: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "NEED_INFO"] } },
            }),
            this.prisma.providerProfile.count({ where: { status: "APPROVED" } }),
            this.prisma.user.count({ where: { status: "BLOCKED" } }),
        ]);
        const rideCommissions = completedRides.reduce((s, r) => s + r.commission, 0);
        const deliveryCommissions = completedDeliveries.reduce((s, d) => s + Math.round(d.price * 0.15), 0);
        return {
            users,
            rides,
            completedRides: completedRides.length,
            deliveries,
            completedDeliveries: completedDeliveries.length,
            commissionsRevenue: rideCommissions + deliveryCommissions,
            agencies,
            providersPending,
            providersApproved,
            blockedUsers,
        };
    }
    async users(q, role) {
        const search = q?.trim();
        return this.prisma.user.findMany({
            where: {
                ...(role && Object.values(client_1.Role).includes(role) ? { role: role } : {}),
                ...(search
                    ? {
                        OR: [
                            { phone: { contains: search, mode: "insensitive" } },
                            { fullName: { contains: search, mode: "insensitive" } },
                        ],
                    }
                    : {}),
            },
            include: {
                wallet: { select: { balance: true } },
                provider: { select: { id: true, type: true, status: true, kycScore: true } },
                agency: { select: { id: true, name: true, plan: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
        });
    }
    async setUserStatus(adminId, userId, dto) {
        if (adminId === userId && dto.status === "BLOCKED") {
            throw new common_1.BadRequestException("Tu ne peux pas bloquer ton propre compte administrateur");
        }
        const target = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { provider: true },
        });
        if (!target)
            throw new common_1.NotFoundException("Utilisateur introuvable");
        const updated = await this.prisma.user.update({
            where: { id: userId },
            data: { status: dto.status },
            include: {
                wallet: { select: { balance: true } },
                provider: { select: { id: true, type: true, status: true, kycScore: true } },
                agency: { select: { id: true, name: true, plan: true } },
            },
        });
        if (target.provider) {
            await this.prisma.providerEvent.create({
                data: {
                    providerId: target.provider.id,
                    actorId: adminId,
                    type: dto.status === "BLOCKED" ? "SUSPENDED" : "REINSTATED",
                    comment: dto.status === "BLOCKED"
                        ? `Compte bloqué depuis la gestion utilisateurs${dto.reason ? ` : ${dto.reason}` : ""}`
                        : "Compte débloqué depuis la gestion utilisateurs",
                },
            });
        }
        return updated;
    }
    async auditLog() {
        const events = await this.prisma.providerEvent.findMany({
            orderBy: { createdAt: "desc" },
            take: 60,
            include: {
                provider: {
                    select: {
                        id: true,
                        type: true,
                        fullName: true,
                        agencyName: true,
                        user: { select: { phone: true } },
                    },
                },
            },
        });
        return events.map((e) => ({
            id: e.id,
            type: e.type,
            comment: e.comment,
            actorId: e.actorId,
            createdAt: e.createdAt,
            provider: {
                id: e.provider.id,
                type: e.provider.type,
                name: e.provider.fullName ?? e.provider.agencyName ?? e.provider.user.phone,
                phone: e.provider.user.phone,
            },
        }));
    }
};
exports.AdminService = AdminService;
exports.AdminService = AdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        wallet_module_1.WalletService,
        pricing_module_1.PricingService])
], AdminService);
let AdminController = class AdminController {
    constructor(svc) {
        this.svc = svc;
    }
    stats() {
        return this.svc.stats();
    }
    users(q, role) {
        return this.svc.users(q, role);
    }
    setUserStatus(u, id, dto) {
        return this.svc.setUserStatus(u.userId, id, dto);
    }
    auditLog() {
        return this.svc.auditLog();
    }
    // POST /admin/settlements/zem-monthly  { "period": "2026-09" }
    // Prélèvement mensuel des Zem indépendants : 15 % des revenus du mois (idempotent).
    zemMonthly(dto) {
        return this.svc.chargeZemMonthly(dto.period);
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)("stats"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "stats", null);
__decorate([
    (0, common_1.Get)("users"),
    __param(0, (0, common_1.Query)("q")),
    __param(1, (0, common_1.Query)("role")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "users", null);
__decorate([
    (0, common_1.Post)("users/:id/status"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, UpdateUserStatusDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "setUserStatus", null);
__decorate([
    (0, common_1.Get)("audit-log"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "auditLog", null);
__decorate([
    (0, common_1.Post)("settlements/zem-monthly"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [MonthlySettlementDto]),
    __metadata("design:returntype", void 0)
], AdminController.prototype, "zemMonthly", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.Controller)("admin"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(client_1.Role.ADMIN),
    __metadata("design:paramtypes", [AdminService])
], AdminController);
let AdminModule = class AdminModule {
};
exports.AdminModule = AdminModule;
exports.AdminModule = AdminModule = __decorate([
    (0, common_1.Module)({
        imports: [wallet_module_1.WalletModule, pricing_module_1.PricingModule],
        controllers: [AdminController],
        providers: [AdminService],
    })
], AdminModule);
//# sourceMappingURL=admin.module.js.map