import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { ProvidersService } from "../providers/providers.module";
import { beninPhoneVariants, extractLocalBeninDigits, normalizeBeninPhone } from "../common/phone";

const MAX_OTP_REQUESTS_WINDOW = 15;
const OTP_WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_VERIFY_ATTEMPTS = 8;

@Injectable()
export class AuthService {
  // Protection anti-bruteforce en mémoire par numéro normalisé
  private failedAttempts = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private providers: ProvidersService
  ) {}

  private assertValidBeninPhone(rawPhone: string): { phone: string; variants: string[] } {
    const local = extractLocalBeninDigits(rawPhone);
    if (local.length !== 10 && local.length !== 8) {
      throw new BadRequestException(
        "Numéro béninois invalide : saisis les 10 chiffres commençant par 01 (ex. 01 97 00 00 42)"
      );
    }
    if (local.length === 10 && !local.startsWith("01")) {
      throw new BadRequestException(
        "Au Bénin (+229), un numéro à 10 chiffres commence par 01 (ex. 01 97 00 00 42)"
      );
    }
    return {
      phone: normalizeBeninPhone(rawPhone),
      variants: beninPhoneVariants(rawPhone),
    };
  }

  async requestOtp(rawPhone: string) {
    const { phone, variants } = this.assertValidBeninPhone(rawPhone);

    // Limitation du nombre de demandes OTP sur une fenêtre glissante de 10 minutes
    const windowStart = new Date(Date.now() - OTP_WINDOW_MS);
    const recentCount = await this.prisma.otpCode.count({
      where: { phone: { in: variants }, createdAt: { gt: windowStart } },
    });
    if (recentCount >= MAX_OTP_REQUESTS_WINDOW) {
      throw new BadRequestException(
        "Trop de demandes de code pour ce numéro. Patiente quelques minutes avant de réessayer."
      );
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

  async verifyOtp(rawPhone: string, code: string, profile?: string) {
    const { phone, variants } = this.assertValidBeninPhone(rawPhone);

    const attempt = this.failedAttempts.get(phone);
    if (attempt && Date.now() - attempt.firstAt < OTP_WINDOW_MS && attempt.count >= MAX_VERIFY_ATTEMPTS) {
      await this.prisma.otpCode.updateMany({
        where: { phone: { in: variants }, consumed: false },
        data: { consumed: true },
      });
      throw new BadRequestException(
        "Trop de tentatives erronées. Demande un nouveau code de vérification."
      );
    }

    const otp = await this.prisma.otpCode.findFirst({
      where: { phone: { in: variants }, code: code.trim(), consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) {
      const prev = this.failedAttempts.get(phone);
      const now = Date.now();
      if (!prev || now - prev.firstAt > OTP_WINDOW_MS) {
        this.failedAttempts.set(phone, { count: 1, firstAt: now });
      } else {
        this.failedAttempts.set(phone, { count: prev.count + 1, firstAt: prev.firstAt });
      }
      throw new BadRequestException("Code invalide ou expiré");
    }

    this.failedAttempts.delete(phone);
    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });

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
    } else if (user.phone !== phone) {
      // Migration douce du numéro 8 chiffres -> 10 chiffres (+22901...) s'il n'est pas déjà pris
      const collision = await this.prisma.user.findUnique({ where: { phone } });
      if (!collision) {
        user = await this.prisma.user.update({ where: { id: user.id }, data: { phone } });
      }
    }

    if (user.status === "BLOCKED") {
      throw new ForbiddenException("Compte suspendu par AZƆ̀ : contacte le support pour le réactiver");
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
}
