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
exports.RidesController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const client_1 = require("@prisma/client");
const rides_service_1 = require("./rides.service");
const create_ride_dto_1 = require("./dto/create-ride.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
class RateDto {
}
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(5),
    __metadata("design:type", Number)
], RateDto.prototype, "stars", void 0);
let RidesController = class RidesController {
    constructor(rides) {
        this.rides = rides;
    }
    // POST /rides/estimate  -> prix + durée avant confirmation
    estimate(dto) {
        return this.rides.estimate(dto);
    }
    // POST /rides  -> le client confirme sa demande
    create(user, dto) {
        return this.rides.create(user.userId, dto);
    }
    // GET /rides/history
    history(user) {
        return this.rides.history(user.userId);
    }
    // GET /rides/pending  -> courses à prendre (chauffeurs)
    pending() {
        return this.rides.pending();
    }
    accept(id, user) {
        return this.rides.accept(id, user.userId);
    }
    start(id, user) {
        return this.rides.start(id, user.userId);
    }
    complete(id, user) {
        return this.rides.complete(id, user.userId);
    }
    // POST /rides/:id/rate  { "stars": 5 }
    rate(id, user, dto) {
        return this.rides.rate(id, user.userId, dto.stars);
    }
    // GET /rides/:id  -> déclaré en DERNIER pour ne pas masquer /history et /pending
    findOne(id, user) {
        return this.rides.findOne(id, user.userId);
    }
};
exports.RidesController = RidesController;
__decorate([
    (0, common_1.Post)("estimate"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_ride_dto_1.CreateRideDto]),
    __metadata("design:returntype", void 0)
], RidesController.prototype, "estimate", null);
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)(client_1.Role.CLIENT),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_ride_dto_1.CreateRideDto]),
    __metadata("design:returntype", void 0)
], RidesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)("history"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RidesController.prototype, "history", null);
__decorate([
    (0, common_1.Get)("pending"),
    (0, roles_decorator_1.Roles)(client_1.Role.DRIVER),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RidesController.prototype, "pending", null);
__decorate([
    (0, common_1.Post)(":id/accept"),
    (0, roles_decorator_1.Roles)(client_1.Role.DRIVER),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], RidesController.prototype, "accept", null);
__decorate([
    (0, common_1.Post)(":id/start"),
    (0, roles_decorator_1.Roles)(client_1.Role.DRIVER),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], RidesController.prototype, "start", null);
__decorate([
    (0, common_1.Post)(":id/complete"),
    (0, roles_decorator_1.Roles)(client_1.Role.DRIVER),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], RidesController.prototype, "complete", null);
__decorate([
    (0, common_1.Post)(":id/rate"),
    (0, roles_decorator_1.Roles)(client_1.Role.CLIENT),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, RateDto]),
    __metadata("design:returntype", void 0)
], RidesController.prototype, "rate", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], RidesController.prototype, "findOne", null);
exports.RidesController = RidesController = __decorate([
    (0, common_1.Controller)("rides"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [rides_service_1.RidesService])
], RidesController);
//# sourceMappingURL=rides.controller.js.map