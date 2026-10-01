import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { ProvidersService } from "../providers/providers.module";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private providers: ProvidersService
  ) {}

  // Normalise : garde uniquement les chiffres, préfixe +229
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    const local = digits.startsWith("229") ? digits.slice(3) : digits;
    return `+229${local}`;
  }

  async requestOtp(rawPhone: string) {
    const phone = this.normalizePhone(rawPhone);
    const code = Math.floor(1000 + Math.random() * 9000).toString(); // 4 chiffres
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // valable 5 min

    await this.prisma.otpCode.create({ data: { phone, code, expiresAt } });

    // TODO : envoyer réellement le SMS (Twilio / passerelle locale) avec `code`.
    // En développement, on l'affiche dans la console du serveur.
    console.log(`[OTP DEV] ${phone} -> ${code}`);

    return { message: "Code envoyé", phone };
  }

  async verifyOtp(rawPhone: string, code: string, profile?: string) {
    const phone = this.normalizePhone(rawPhone);

    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, code, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) throw new BadRequestException("Code invalide ou expiré");

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });

    // L'inscription crée TOUJOURS un compte client (avec son portefeuille).
    // Le rôle prestataire ne se choisit plus ici : il est accordé par un administrateur
    // après examen du dossier (pièces d'identité, permis, RCCM...). Avant cette règle,
    // n'importe qui pouvait s'auto-attribuer le rôle DRIVER ou AGENCY en un tap.
    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { phone, wallet: { create: {} } },
      });
    }
    if (user.status === "BLOCKED") {
      throw new ForbiddenException("Compte suspendu par AZƆ̀ : contacte le support pour le réactiver");
    }

    // Le profil déclaré à l'inscription ouvre un BROUILLON de dossier prestataire :
    // rien n'est accordé tant qu'un admin ne l'a pas approuvé.
    let provider = await this.providers.statusOf(user.id);
    if (!provider && (profile === "DRIVER" || profile === "AGENCY")) {
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
      // Sert à l'app pour afficher l'écran « Dossier en cours » (étape 3b) :
      // status DRAFT = à compléter, SUBMITTED/UNDER_REVIEW = en attente, APPROVED = actif.
      provider: provider ? { id: provider.id, type: provider.type, status: provider.status } : null,
    };
  }
}
