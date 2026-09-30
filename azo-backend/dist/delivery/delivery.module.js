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
exports.DeliveryModule = exports.DeliveryController = exports.DeliveryService = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
class CreateDeliveryDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateDeliveryDto.prototype, "packageType", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateDeliveryDto.prototype, "pickupAddress", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateDeliveryDto.prototype, "dropAddress", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(client_1.Payer),
    __metadata("design:type", String)
], CreateDeliveryDto.prototype, "payer", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], CreateDeliveryDto.prototype, "price", void 0);
class ConfirmCodeDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ConfirmCodeDto.prototype, "code", void 0);
const code4 = () => Math.floor(1000 + Math.random() * 9000).toString();
let DeliveryService = class DeliveryService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    // Double sécurité OTP : un code au ramassage, un code à la remise
    create(clientId, dto) {
        return this.prisma.delivery.create({
            data: { ...dto, clientId, pickupCode: code4(), deliveryCode: code4() },
        });
    }
    list(clientId) {
        return this.prisma.delivery.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } });
    }
    async confirmPickup(id, code) {
        const d = await this.prisma.delivery.findUnique({ where: { id } });
        if (!d || d.pickupCode !== code)
            throw new common_1.BadRequestException("Code de ramassage invalide");
        return this.prisma.delivery.update({ where: { id }, data: { status: "IN_PROGRESS" } });
    }
    async confirmDelivery(id, code) {
        const d = await this.prisma.delivery.findUnique({ where: { id } });
        if (!d || d.deliveryCode !== code)
            throw new common_1.BadRequestException("Code de remise invalide");
        return this.prisma.delivery.update({ where: { id }, data: { status: "COMPLETED" } });
    }
};
exports.DeliveryService = DeliveryService;
exports.DeliveryService = DeliveryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DeliveryService);
let DeliveryController = class DeliveryController {
    constructor(svc) {
        this.svc = svc;
    }
    create(u, dto) { return this.svc.create(u.userId, dto); }
    list(u) { return this.svc.list(u.userId); }
    pickup(id, b) { return this.svc.confirmPickup(id, b.code); }
    drop(id, b) { return this.svc.confirmDelivery(id, b.code); }
};
exports.DeliveryController = DeliveryController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateDeliveryDto]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(":id/confirm-pickup"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ConfirmCodeDto]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "pickup", null);
__decorate([
    (0, common_1.Post)(":id/confirm-delivery"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ConfirmCodeDto]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "drop", null);
exports.DeliveryController = DeliveryController = __decorate([
    (0, common_1.Controller)("deliveries"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [DeliveryService])
], DeliveryController);
let DeliveryModule = class DeliveryModule {
};
exports.DeliveryModule = DeliveryModule;
exports.DeliveryModule = DeliveryModule = __decorate([
    (0, common_1.Module)({ controllers: [DeliveryController], providers: [DeliveryService] })
], DeliveryModule);
//# sourceMappingURL=delivery.module.js.map