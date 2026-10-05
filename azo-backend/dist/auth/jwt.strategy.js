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
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtStrategy = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const passport_jwt_1 = require("passport-jwt");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_secret_1 = require("../common/jwt-secret");
let JwtStrategy = class JwtStrategy extends (0, passport_1.PassportStrategy)(passport_jwt_1.Strategy) {
    constructor(prisma) {
        super({
            // Accepte l'en-tête Authorization: Bearer <jwt> OU ?token=<jwt> (utile pour les
            // balises <Image> React Native sur Android qui n'envoient pas toujours les headers).
            jwtFromRequest: passport_jwt_1.ExtractJwt.fromExtractors([
                passport_jwt_1.ExtractJwt.fromAuthHeaderAsBearerToken(),
                passport_jwt_1.ExtractJwt.fromUrlQueryParameter("token"),
            ]),
            ignoreExpiration: false,
            secretOrKey: (0, jwt_secret_1.getJwtSecret)(),
        });
        this.prisma = prisma;
    }
    // Le rôle et le statut sont relus en base à chaque requête : une suspension admin
    // ou une approbation de dossier prestataire prend effet immédiatement.
    async validate(payload) {
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, role: true, status: true, phone: true },
        });
        if (!user)
            throw new common_1.UnauthorizedException("Compte introuvable");
        if (user.status === "BLOCKED")
            throw new common_1.UnauthorizedException("Compte suspendu par AZƆ̀ : contacte le support");
        return { userId: user.id, role: user.role, phone: user.phone };
    }
};
exports.JwtStrategy = JwtStrategy;
exports.JwtStrategy = JwtStrategy = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], JwtStrategy);
//# sourceMappingURL=jwt.strategy.js.map