import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { ProvidersService } from "../providers/providers.module";
import { beninPhoneVariants, extractLocalBeninDigits, normalizeBeninPhone } from "../common/phone";

const MAX_OTP_REQUESTS_WINDOW = 15;
const OTP_WINDOW_MS = 10 * 60 * 1000; // 10 min
export const OTP_TTL_MS = 60 * 1000; // un code de connexion est valable 1 minute
export const MAX_VERIFY_ATTEMPTS = 3; // codes erronés tolérés par numéro...
export const OTP_ATTEMPT_WINDOW_MS = 60 * 60 * 1000; // ...sur une heure glissante

type AttemptRow = { attempts: number; createdAt: Date };

/**
 * Blocage d'un numéro : `MAX_VERIFY_ATTEMPTS` saisies erronées dans la dernière heure.
 * Le blocage dure jusqu'à ce que la fenêtre libère assez d'essais : on retire les codes
 * les plus anciens jusqu'à repasser sous la limite, et c'est l'âge du dernier retiré
 * (+ 1 h) qui donne l'heure de déblocage. Fonction pure, testée sans base.
 */
export function otpLockStatus(
  rows: AttemptRow[],
  now: number = Date.now()
): { locked: false } | { locked: true; retryAt: Date } {
  const recent = rows
    .filter((r) => r.attempts > 0 && now - new Date(r.createdAt).getTime() < OTP_ATTEMPT_WINDOW_MS)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let total = recent.reduce((sum, r) => sum + r.attempts, 0);
  if (total < MAX_VERIFY_ATTEMPTS) return { locked: false };
  for (const row of recent) {
    total -= row.attempts;
    if (total < MAX_VERIFY_ATTEMPTS) {
      return { locked: true, retryAt: new Date(new Date(row.createdAt).getTime() + OTP_ATTEMPT_WINDOW_MS) };
    }
  }
  return { locked: true, retryAt: new Date(now + OTP_ATTEMPT_WINDOW_MS) };
}

const lockedMessage = (retryAt: Date) => {
  const minutes = Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 60000));
  return `Trop de tentatives erronées. Réessaie dans ${minutes} minute${minutes > 1 ? "s" : ""}.`;
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private providers: ProvidersService
  ) {}

  private assertValidBeninPhone(rawPhone: string): { phone: string; variants: string[] } {
    const local = extractLocalBeninDigits(rawPhone);
    if (local.length !== 10 && local.length !== 8) {
      throw new BadRequestException(
        "Numéro béninois invalide : saisis les 10 chiffres commençant par 01 (ex. 01 XX XX XX XX)"
      );
    }
    if (local.length === 10 && !local.startsWith("01")) {
      throw new BadRequestException(
        "Au Bénin (+229), un numéro à 10 chiffres commence par 01 (ex. 01 XX XX XX XX)"
      );
    }
    return {
      phone: normalizeBeninPhone(rawPhone),
      variants: beninPhoneVariants(rawPhone),
    };
  }

  async requestOtp(rawPhone: string) {
    const { phone, variants } = this.assertValidBeninPhone(rawPhone);

    // Numéro bloqué (3 codes faux en 1 h) : inutile d'envoyer un code qu'il ne pourrait
    // pas utiliser. En simulation le blocage de la demande est levé (le code 0000 reste
    // utilisable), pour ne pas bloquer les tests sur téléphone.
    if (process.env.SMS_PROVIDER === "live") await this.assertNotLocked(variants);

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
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.otpCode.create({ data: { phone, code, expiresAt } });

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

  private recentAttempts(variants: string[]): Promise<AttemptRow[]> {
    return this.prisma.otpCode.findMany({
      where: {
        phone: { in: variants },
        attempts: { gt: 0 },
        createdAt: { gt: new Date(Date.now() - OTP_ATTEMPT_WINDOW_MS) },
      },
      select: { attempts: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  private async assertNotLocked(variants: string[]) {
    const status = otpLockStatus(await this.recentAttempts(variants));
    if (status.locked) throw new BadRequestException(lockedMessage(status.retryAt));
  }

  /**
   * Vérifie le code de connexion : 3 saisies erronées par heure et par numéro, comptées en
   * base (elles survivent à un redémarrage et valent pour toutes les instances). Demander
   * un nouveau code ne remet pas le compteur à zéro. Une connexion réussie le remet à zéro.
   */
  private async checkOtp(variants: string[], code: string) {
    await this.assertNotLocked(variants);

    const otp = await this.prisma.otpCode.findFirst({
      where: { phone: { in: variants }, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) throw new BadRequestException("Code invalide ou expiré");

    if (otp.code !== code) {
      // Incrément atomique, puis total relu : des essais simultanés ne dépassent pas la limite.
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      const rows = await this.recentAttempts(variants);
      const status = otpLockStatus(rows);
      if (status.locked) {
        await this.prisma.otpCode.updateMany({ where: { id: otp.id }, data: { consumed: true } });
        throw new BadRequestException(lockedMessage(status.retryAt));
      }
      const used = rows.reduce((sum, r) => sum + r.attempts, 0);
      const left = MAX_VERIFY_ATTEMPTS - used;
      throw new BadRequestException(`Code incorrect. Il te reste ${left} essai${left > 1 ? "s" : ""}.`);
    }

    // Consommation conditionnelle : un même code ne peut ouvrir qu'une seule session.
    const { count } = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumed: false },
      data: { consumed: true },
    });
    if (count !== 1) throw new BadRequestException("Code invalide ou expiré");

    // Connexion réussie : les essais ratés d'avant ne comptent plus.
    await this.prisma.otpCode.updateMany({
      where: { phone: { in: variants }, attempts: { gt: 0 } },
      data: { attempts: 0 },
    });
  }

  async verifyOtp(rawPhone: string, code: string, profile?: string) {
    const { phone, variants } = this.assertValidBeninPhone(rawPhone);

    const isSimBypass = process.env.SMS_PROVIDER !== "live" && code.trim() === "0000";
    if (!isSimBypass) await this.checkOtp(variants, code.trim());

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
