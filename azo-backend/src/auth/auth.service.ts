import { BadRequestException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { ProvidersService } from "../providers/providers.module";
import { beninPhoneVariants, extractLocalBeninDigits, normalizeBeninPhone } from "../common/phone";
import { toUserProfile } from "../common/registration-profile";
import { ReferralsService } from "../referrals/referrals.module";
import { verifyPassword } from "../common/password";

const MAX_OTP_REQUESTS_WINDOW = 15;
const ADMIN_MAX_FAILURES = 5;
const ADMIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
// Empreinte factice (mot de passe inconnu) pour que la durée de réponse ne révèle pas si le compte existe
const DUMMY_HASH = "scrypt$16384$00000000000000000000000000000000$" + "00".repeat(64);
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
    private providers: ProvidersService,
    @Optional() private referrals?: ReferralsService
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

  /** Échecs de connexion administrateur récents, par numéro et par adresse (en mémoire : redémarrage = remise à zéro). */
  private adminFailures = new Map<string, number[]>();

  private adminLockedFor(keys: string[], now: number): number {
    let wait = 0;
    for (const key of keys) {
      const recent = (this.adminFailures.get(key) ?? []).filter((t) => now - t < ADMIN_LOCK_WINDOW_MS);
      this.adminFailures.set(key, recent);
      if (recent.length >= ADMIN_MAX_FAILURES) wait = Math.max(wait, ADMIN_LOCK_WINDOW_MS - (now - recent[0]));
    }
    return wait;
  }

  /**
   * Connexion de la console web administrateur : numéro + mot de passe. Au plus 5 échecs en 15 minutes par numéro (et 20 par adresse) ;
   * la même réponse « identifiants incorrects » que le compte existe ou non. Le jeton dure 12 heures.
   */
  async adminLogin(rawPhone: string, password: string, ip: string) {
    const { variants, phone } = this.assertValidBeninPhone(rawPhone);
    const keys = [`phone:${phone}`, `ip:${ip || "?"}`];
    const now = Date.now();
    const wait = this.adminLockedFor(keys, now);
    if (wait > 0) {
      throw new ForbiddenException(`Trop de tentatives. Réessaie dans ${Math.max(1, Math.ceil(wait / 60000))} minute(s).`);
    }
    const user = await this.prisma.user.findFirst({ where: { phone: { in: variants } }, orderBy: { createdAt: "asc" } });
    // Même durée de calcul qu'un compte existant : on vérifie toujours une empreinte
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || user.role !== "ADMIN" || !user.passwordHash || !ok) {
      for (const key of keys) this.adminFailures.set(key, [...(this.adminFailures.get(key) ?? []), now]);
      throw new ForbiddenException("Numéro ou mot de passe incorrect.");
    }
    if (user.status === "BLOCKED") throw new ForbiddenException("Compte suspendu.");
    for (const key of keys) this.adminFailures.delete(key);
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role, phone: user.phone }, { expiresIn: "12h" });
    return { token, user: { id: user.id, phone: user.phone, fullName: user.fullName, role: user.role } };
  }

  async verifyOtp(rawPhone: string, code: string, profile?: string, referralCode?: string) {
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

    // Un compte administrateur ne s'ouvre pas avec le code de simulation (0000 ou code affiché par l'API) : tant que les SMS réels
    // ne sont pas branchés, il se connecte par mot de passe sur la console web.
    if (user.role === "ADMIN" && process.env.SMS_PROVIDER !== "live") {
      throw new ForbiddenException("Les comptes administrateur se connectent avec leur mot de passe sur la console web.");
    }

    // Le profil déclaré à l'inscription ouvre un BROUILLON de dossier prestataire :
    // rien n'est accordé tant qu'un admin ne l'a pas approuvé.
    // Un compte professionnel (Speeder, coursier, livreur, agence) ne remplit pas le formulaire d'identité :
    // seul son numéro est demandé ; le type choisi est mémorisé tel quel (l'agence en a besoin pour ouvrir son dossier).
    const proKind = profile === "DRIVER" || profile === "COURIER" || profile === "AGENCY" ? profile : null;
    if (proKind && !user.signupKind && !user.profileCompletedAt) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { signupKind: proKind } });
    }

    let provider = await this.providers.statusOf(user.id);
    if (!provider && (profile === "DRIVER" || profile === "COURIER" || profile === "AGENCY")) {
      await this.providers.openDraftOnSignup(user.id, profile);
      provider = await this.providers.statusOf(user.id);
    }

    // Parrainage : un client ou un prestataire qui s'inscrit peut saisir le code de son commercial (jamais bloquant ; sans effet pour un
    // compte déjà inscrit ou déjà parrainé)
    let referralStatus: "APPLIED" | "INVALID" | null = null;
    if (this.referrals) {
      const result = await this.referrals.attachByCode(user.id, referralCode).catch(() => "INVALID" as const);
      referralStatus = result === "IGNORED" ? null : result;
    }
    // Compte parrain (créé par l'administrateur) : l'application ouvre l'espace parrain
    const referrer = this.referrals ? await this.referrals.referrerOf(user.id).catch(() => null) : null;

    const token = await this.jwt.signAsync({ sub: user.id, role: user.role, phone: user.phone });
    return {
      token,
      user: toUserProfile({
        id: user.id,
        phone: user.phone,
        role: user.role,
        status: user.status,
        fullName: user.fullName,
        createdAt: user.createdAt,
        firstName: user.firstName,
        lastName: user.lastName,
        gender: user.gender,
        npiHash: user.npiHash,
        npiCipher: user.npiCipher,
        npiLast4: user.npiLast4,
      }),
      signupKind: user.signupKind ?? null,
      referralStatus,
      referrer,
      provider: provider ? { id: provider.id, type: provider.type, status: provider.status } : null,
    };
  }
}
