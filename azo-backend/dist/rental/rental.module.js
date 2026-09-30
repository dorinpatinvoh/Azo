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
exports.RentalModule = exports.RentalController = exports.RentalService = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
class BookDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BookDto.prototype, "vehicleModel", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BookDto.prototype, "formula", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], BookDto.prototype, "pricePerDay", void 0);
// Catalogue statique pour démarrer — à remplacer par une table Vehicle gérée par les loueurs
const CATALOG = [
    { id: "corolla", name: "Toyota Corolla Prestige", pricePerDay: 28000, seats: 4 },
    { id: "tucson", name: "Hyundai Tucson SUV Confort", pricePerDay: 35000, seats: 5 },
];
let RentalService = class RentalService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    catalog() { return CATALOG; }
    book(clientId, dto) { return this.prisma.rentalBooking.create({ data: { ...dto, clientId } }); }
    mine(clientId) { return this.prisma.rentalBooking.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } }); }
};
exports.RentalService = RentalService;
exports.RentalService = RentalService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RentalService);
let RentalController = class RentalController {
    constructor(svc) {
        this.svc = svc;
    }
    catalog() { return this.svc.catalog(); }
    book(u, dto) { return this.svc.book(u.userId, dto); }
    mine(u) { return this.svc.mine(u.userId); }
};
exports.RentalController = RentalController;
__decorate([
    (0, common_1.Get)("catalog"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RentalController.prototype, "catalog", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, BookDto]),
    __metadata("design:returntype", void 0)
], RentalController.prototype, "book", null);
__decorate([
    (0, common_1.Get)("mine"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RentalController.prototype, "mine", null);
exports.RentalController = RentalController = __decorate([
    (0, common_1.Controller)("rentals"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [RentalService])
], RentalController);
let RentalModule = class RentalModule {
};
exports.RentalModule = RentalModule;
exports.RentalModule = RentalModule = __decorate([
    (0, common_1.Module)({ controllers: [RentalController], providers: [RentalService] })
], RentalModule);
//# sourceMappingURL=rental.module.js.map