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
exports.ArtisansModule = exports.ArtisansController = exports.ArtisansService = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
class RequestDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RequestDto.prototype, "category", void 0);
let ArtisansService = class ArtisansService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    // Les artisans sont des utilisateurs avec le rôle ARTISAN
    list() {
        return this.prisma.user.findMany({
            where: { role: "ARTISAN" },
            select: { id: true, fullName: true, phone: true },
        });
    }
    request(clientId, dto) {
        return this.prisma.artisanRequest.create({ data: { clientId, category: dto.category } });
    }
};
exports.ArtisansService = ArtisansService;
exports.ArtisansService = ArtisansService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ArtisansService);
let ArtisansController = class ArtisansController {
    constructor(svc) {
        this.svc = svc;
    }
    list(_category) { return this.svc.list(); }
    request(u, dto) { return this.svc.request(u.userId, dto); }
};
exports.ArtisansController = ArtisansController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)("category")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ArtisansController.prototype, "list", null);
__decorate([
    (0, common_1.Post)("requests"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, RequestDto]),
    __metadata("design:returntype", void 0)
], ArtisansController.prototype, "request", null);
exports.ArtisansController = ArtisansController = __decorate([
    (0, common_1.Controller)("artisans"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [ArtisansService])
], ArtisansController);
let ArtisansModule = class ArtisansModule {
};
exports.ArtisansModule = ArtisansModule;
exports.ArtisansModule = ArtisansModule = __decorate([
    (0, common_1.Module)({ controllers: [ArtisansController], providers: [ArtisansService] })
], ArtisansModule);
//# sourceMappingURL=artisans.module.js.map