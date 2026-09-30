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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("../prisma/prisma.service");
let AuthService = class AuthService {
    constructor(prisma, jwt) {
        this.prisma = prisma;
        this.jwt = jwt;
    }
    // Normalise : garde uniquement les chiffres, préfixe +229
    normalizePhone(phone) {
        const digits = phone.replace(/\D/g, "");
        const local = digits.startsWith("229") ? digits.slice(3) : digits;
        return `+229${local}`;
    }
    async requestOtp(rawPhone) {
        const phone = this.normalizePhone(rawPhone);
        const code = Math.floor(1000 + Math.random() * 9000).toString(); // 4 chiffres
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // valable 5 min
        await this.prisma.otpCode.create({ data: { phone, code, expiresAt } });
        // TODO : envoyer réellement le SMS (Twilio / passerelle locale) avec `code`.
        // En développement, on l'affiche dans la console du serveur.
        console.log(`[OTP DEV] ${phone} -> ${code}`);
        return { message: "Code envoyé", phone };
    }
    async verifyOtp(rawPhone, code, profile) {
        const phone = this.normalizePhone(rawPhone);
        const otp = await this.prisma.otpCode.findFirst({
            where: { phone, code, consumed: false, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
        });
        if (!otp)
            throw new common_1.BadRequestException("Code invalide ou expiré");
        await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });
        // Crée l'utilisateur (et son portefeuille) à la première connexion
        const role = profile === "DRIVER" || profile === "AGENCY" ? profile : "CLIENT";
        let user = await this.prisma.user.findUnique({ where: { phone } });
        if (!user) {
            user = await this.prisma.user.create({
                data: { phone, role, wallet: { create: {} } },
            });
        }
        const token = await this.jwt.signAsync({ sub: user.id, role: user.role, phone: user.phone });
        return { token, user: { id: user.id, phone: user.phone, role: user.role, fullName: user.fullName } };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, jwt_1.JwtService])
], AuthService);
//# sourceMappingURL=auth.service.js.map