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
exports.AgenciesModule = exports.AgenciesController = exports.AgenciesService = exports.PLANS = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
// Formules du modèle économique : activation unique, comptes max., commission
exports.PLANS = {
    PRO: { fee: 45000, maxAccounts: 10, rate: 0.03 },
    ARGENT: { fee: 100000, maxAccounts: 25, rate: 0.025 },
    OR: { fee: 250000, maxAccounts: 100, rate: 0.02 },
    DIAMANT: { fee: 500000, maxAccounts: 1000, rate: 0.01 },
};
class CreateAgencyDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateAgencyDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(client_1.AgencyPlan),
    __metadata("design:type", String)
], CreateAgencyDto.prototype, "plan", void 0);
class AddDriverDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddDriverDto.prototype, "phone", void 0);
let AgenciesService = class AgenciesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(ownerId, dto) {
        const p = exports.PLANS[dto.plan];
        const agency = await this.prisma.agency.create({
            data: { name: dto.name, plan: dto.plan, commissionRate: p.rate, maxAccounts: p.maxAccounts },
        });
        await this.prisma.user.update({ where: { id: ownerId }, data: { role: "AGENCY", agencyId: agency.id } });
        return agency;
    }
    async addDriver(ownerId, phone) {
        const owner = await this.prisma.user.findUnique({ where: { id: ownerId }, include: { agency: { include: { drivers: true } } } });
        if (!owner?.agency)
            throw new common_1.BadRequestException("Aucune agence liée à ce compte");
        if (owner.agency.drivers.length >= owner.agency.maxAccounts)
            throw new common_1.BadRequestException("Capacité de comptes atteinte pour votre formule");
        return this.prisma.user.update({ where: { phone }, data: { role: "DRIVER", agencyId: owner.agency.id } });
    }
    async dashboard(ownerId) {
        const owner = await this.prisma.user.findUnique({ where: { id: ownerId }, include: { agency: { include: { drivers: true } } } });
        if (!owner?.agency)
            throw new common_1.BadRequestException("Aucune agence liée à ce compte");
        const driverIds = owner.agency.drivers.map((d) => d.id);
        const rides = await this.prisma.ride.findMany({ where: { driverId: { in: driverIds }, status: "COMPLETED" } });
        return {
            agency: { id: owner.agency.id, name: owner.agency.name, plan: owner.agency.plan },
            drivers: owner.agency.drivers.length,
            completedRides: rides.length,
            netRevenue: rides.reduce((s, r) => s + (r.price - r.commission), 0),
        };
    }
};
exports.AgenciesService = AgenciesService;
exports.AgenciesService = AgenciesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AgenciesService);
let AgenciesController = class AgenciesController {
    constructor(svc) {
        this.svc = svc;
    }
    create(u, dto) { return this.svc.create(u.userId, dto); }
    addDriver(u, dto) { return this.svc.addDriver(u.userId, dto.phone); }
    dashboard(u) { return this.svc.dashboard(u.userId); }
};
exports.AgenciesController = AgenciesController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateAgencyDto]),
    __metadata("design:returntype", void 0)
], AgenciesController.prototype, "create", null);
__decorate([
    (0, common_1.Post)("drivers"),
    (0, roles_decorator_1.Roles)(client_1.Role.AGENCY),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, AddDriverDto]),
    __metadata("design:returntype", void 0)
], AgenciesController.prototype, "addDriver", null);
__decorate([
    (0, common_1.Get)("dashboard"),
    (0, roles_decorator_1.Roles)(client_1.Role.AGENCY),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgenciesController.prototype, "dashboard", null);
exports.AgenciesController = AgenciesController = __decorate([
    (0, common_1.Controller)("agencies"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [AgenciesService])
], AgenciesController);
let AgenciesModule = class AgenciesModule {
};
exports.AgenciesModule = AgenciesModule;
exports.AgenciesModule = AgenciesModule = __decorate([
    (0, common_1.Module)({ controllers: [AgenciesController], providers: [AgenciesService] })
], AgenciesModule);
//# sourceMappingURL=agencies.module.js.map