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
const providers_module_1 = require("../providers/providers.module");
const phone_1 = require("../common/phone");
const MAX_OTP_REQUESTS_WINDOW = 15;
const OTP_WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_VERIFY_ATTEMPTS = 8;
let AuthService = class AuthService {
    constructor(prisma, jwt, providers) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.providers = providers;
        // Protection anti-bruteforce en mémoire par numéro normalisé
        this.failedAttempts = new Map();
    }
    assertValidBeninPhone(rawPhone) {
        const local = (0, phone_1.extractLocalBeninDigits)(rawPhone);
        if (local.length !== 10 && local.length !== 8) {
            throw new common_1.BadRequestException("Numéro béninois invalide : saisis les 10 chiffres commençant par 01 (ex. 01 XX XX XX XX)");
        }
        if (local.length === 10 && !local.startsWith("01")) {
            throw new common_1.BadRequestException("Au Bénin (+229), un numéro à 10 chiffres commence par 01 (ex. 01 XX XX XX XX)");
        }
        return {
            phone: (0, phone_1.normalizeBeninPhone)(rawPhone),
            variants: (0, phone_1.beninPhoneVariants)(rawPhone),
        };
    }
    async requestOtp(rawPhone) {
        const { phone, variants } = this.assertValidBeninPhone(rawPhone);
        // Limitation du nombre de demandes OTP sur une fenêtre glissante de 10 minutes
        const windowStart = new Date(Date.now() - OTP_WINDOW_MS);
        const recentCount = await this.prisma.otpCode.count({
            where: { phone: { in: variants }, createdAt: { gt: windowStart } },
        });
        if (recentCount >= MAX_OTP_REQUESTS_WINDOW) {
            throw new common_1.BadRequestException("Trop de demandes de code pour ce numéro. Patiente quelques minutes avant de réessayer.");
        }
        // Invalide les anciens codes non consommés pour ce numéro
        await this.prisma.otpCode.updateMany({
            where: { phone: { in: variants }, consumed: false },
            data: { consumed: true },
        });
        const code = Math.floor(1000 + Math.random() * 9000).toString(); // 4 chiffres
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // valable 5 min
        await this.prisma.otpCode.create({ data: { phone, code, expiresAt } });
        this.failedAttempts.delete(phone);
        console.log(`[OTP DEV] ${phone} -> ${code}`);
        return {
            message: "Code envoyé",
            phone,
            // En mode simulation (tant qu'aucune passerelle SMS payante n'est activée via SMS_PROVIDER="live"),
            // le code est renvoyé pour que l'application mobile (et l'APK de démonstration) puisse afficher
            // une bannière de notification SMS pendant 5 secondes à l'écran.
            otpCode: process.env.SMS_PROVIDER === "live" ? undefined : code,
        };
    }
    async verifyOtp(rawPhone, code, profile) {
        const { phone, variants } = this.assertValidBeninPhone(rawPhone);
        const attempt = this.failedAttempts.get(phone);
        if (attempt && Date.now() - attempt.firstAt < OTP_WINDOW_MS && attempt.count >= MAX_VERIFY_ATTEMPTS) {
            await this.prisma.otpCode.updateMany({
                where: { phone: { in: variants }, consumed: false },
                data: { consumed: true },
            });
            throw new common_1.BadRequestException("Trop de tentatives erronées. Demande un nouveau code de vérification.");
        }
        const isSimBypass = process.env.SMS_PROVIDER !== "live" && code.trim() === "0000";
        if (!isSimBypass) {
            const otp = await this.prisma.otpCode.findFirst({
                where: { phone: { in: variants }, code: code.trim(), consumed: false, expiresAt: { gt: new Date() } },
                orderBy: { createdAt: "desc" },
            });
            if (!otp) {
                const prev = this.failedAttempts.get(phone);
                const now = Date.now();
                if (!prev || now - prev.firstAt > OTP_WINDOW_MS) {
                    this.failedAttempts.set(phone, { count: 1, firstAt: now });
                }
                else {
                    this.failedAttempts.set(phone, { count: prev.count + 1, firstAt: prev.firstAt });
                }
                throw new common_1.BadRequestException("Code invalide ou expiré");
            }
            this.failedAttempts.delete(phone);
            await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });
        }
        else {
            this.failedAttempts.delete(phone);
        }
        // Recherche du compte sur le format 10 chiffres (+22901...) ET l'ancien format 8 chiffres (+229...)
        // pour ne perdre aucun compte existant (admin ou prestataire déjà créé).
        let user = await this.prisma.user.findFirst({
            where: { phone: { in: variants } },
            orderBy: { createdAt: "asc" },
        });
        if (!user) {
            user = await this.prisma.user.create({
                data: { phone, wallet: { create: {} } },
            });
        }
        else if (user.phone !== phone) {
            // Migration douce du numéro 8 chiffres -> 10 chiffres (+22901...) s'il n'est pas déjà pris
            const collision = await this.prisma.user.findUnique({ where: { phone } });
            if (!collision) {
                user = await this.prisma.user.update({ where: { id: user.id }, data: { phone } });
            }
        }
        if (user.status === "BLOCKED") {
            throw new common_1.ForbiddenException("Compte suspendu par AZƆ̀ : contacte le support pour le réactiver");
        }
        // Le profil déclaré à l'inscription ouvre un BROUILLON de dossier prestataire :
        // rien n'est accordé tant qu'un admin ne l'a pas approuvé.
        let provider = await this.providers.statusOf(user.id);
        if (!provider && (profile === "DRIVER" || profile === "COURIER" || profile === "AGENCY")) {
            await this.providers.openDraftOnSignup(user.id, profile);
            provider = await this.providers.statusOf(user.id);
        }
        const token = await this.jwt.signAsync({ sub: user.id, role: user.role, phone: user.phone });
        return {
            token,
            user: {
                id: user.id,
                phone: user.phone,
                role: user.role,
                status: user.status,
                fullName: user.fullName,
            },
            provider: provider ? { id: provider.id, type: provider.type, status: provider.status } : null,
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        providers_module_1.ProvidersService])
], AuthService);
//# sourceMappingURL=auth.service.js.map