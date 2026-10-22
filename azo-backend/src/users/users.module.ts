import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { Gender, Role } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { NpiCryptoService } from "../common/npi-crypto.service";
import { isRegistrationComplete, toUserProfile, SUPPORTED_LANGUAGES } from "../common/registration-profile";
import { extractLocalBeninDigits, normalizeBeninPhone } from "../common/phone";
import { NotificationsService } from "../notifications/notifications.module";
import { NotificationsModule } from "../notifications/notifications.module";

export const MAX_REGISTRATION_ATTEMPTS = 3;
export const REGISTRATION_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

// Limite de débit : 10 appels PATCH /users/me/profile par heure
const PROFILE_RATE_LIMIT = 10;
const PROFILE_RATE_WINDOW_MS = 60 * 60 * 1000;

// Limite de débit : 3 demandes phone-change/request par heure
const PHONE_CHANGE_RATE_LIMIT = 3;
const PHONE_CHANGE_RATE_WINDOW_MS = 60 * 60 * 1000;

// Durée de validité d'un code de changement de téléphone
const PHONE_CHANGE_TTL_MS = 5 * 60 * 1000; // 5 min
const PHONE_CHANGE_MAX_ATTEMPTS = 5;

// Fenêtre de correction d'identité directe
const IDENTITY_CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
}

function normalizeNpi(value: unknown) {
  return typeof value === "string" ? value.replace(/[\s.-]/g, "") : value;
}

/** Valide qu'un numéro est un numéro béninois à 10 chiffres commençant par 01 */
function isValidBeninPhone(raw: string): boolean {
  const local = extractLocalBeninDigits(raw);
  return local.length === 10 && local.startsWith("01");
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export class RegisterUserDto {
  @Transform(({ value }) => normalizeName(value))
  @IsString({ message: "Le prénom doit être un texte" })
  @MinLength(2, { message: "Le prénom doit contenir au moins 2 caractères" })
  @MaxLength(50, { message: "Le prénom ne peut pas dépasser 50 caractères" })
  @Matches(/^[\p{L}][\p{L}\s''-]*$/u, {
    message: "Le prénom ne peut contenir que des lettres, espaces, tirets et apostrophes",
  })
  firstName: string;

  @Transform(({ value }) => normalizeName(value))
  @IsString({ message: "Le nom doit être un texte" })
  @MinLength(2, { message: "Le nom doit contenir au moins 2 caractères" })
  @MaxLength(50, { message: "Le nom ne peut pas dépasser 50 caractères" })
  @Matches(/^[\p{L}][\p{L}\s''-]*$/u, {
    message: "Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes",
  })
  lastName: string;

  @IsEnum(Gender, { message: "Le sexe doit être M ou F" })
  gender: Gender;

  @Transform(({ value }) => normalizeNpi(value))
  @IsString({ message: "Le NPI doit être un texte de 10 chiffres" })
  @Matches(/^\d{10}$/, { message: "Le NPI doit contenir exactement 10 chiffres" })
  npi: string;

  // Type de compte choisi à l'inscription (facultatif : un ancien client de l'application n'envoie rien)
  @IsOptional()
  @IsIn(["CLIENT", "DRIVER", "COURIER", "AGENCY"], { message: "Type de compte inconnu" })
  accountKind?: string;
}

export class UpdateProfileDto {
  @Transform(({ value }) => normalizeName(value))
  @IsString({ message: "Le nom ou pseudo doit être un texte" })
  @IsNotEmpty({ message: "Le nom ou pseudo ne peut pas être vide" })
  @MinLength(2, { message: "Le nom ou pseudo doit contenir au moins 2 caractères" })
  @MaxLength(50, { message: "Le nom ou pseudo ne peut pas dépasser 50 caractères" })
  fullName: string;
}

/** Photo de profil : image en data URI (JPEG, PNG ou WEBP), 2 Mo au plus. */
export class UpdateAvatarDto {
  @IsString()
  @Matches(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, { message: "Image invalide : utilise une photo JPG, PNG ou WEBP" })
  @MaxLength(2_800_000, { message: "Photo trop lourde : choisis une photo plus légère (2 Mo au plus)" })
  dataUri: string;
}

export class UpdateLanguageDto {
  @IsIn(SUPPORTED_LANGUAGES, { message: "Langue non supportée. Valeurs acceptées : fr, en, es, de" })
  language: string;
}

class EmergencyContactDto {
  @Transform(({ value }) => normalizeName(value))
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @IsString()
  @Matches(/^\d{10}$|^[+0-9\s]{10,15}$/)
  phone: string;
}

export class UpdateMyProfileDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.toLowerCase().trim() : value))
  @IsEmail({}, { message: "Format d'e-mail invalide" })
  @MinLength(5)
  @MaxLength(120)
  email?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EmergencyContactDto)
  emergencyContact?: EmergencyContactDto | null;
}

export class UpdateIdentityDto {
  @IsOptional()
  @Transform(({ value }) => normalizeName(value))
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[\p{L}][\p{L}\s''-]*$/u)
  firstName?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeName(value))
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[\p{L}][\p{L}\s''-]*$/u)
  lastName?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
}

export class CreateIdentityCorrectionRequestDto {
  @IsOptional()
  @Transform(({ value }) => normalizeName(value))
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[\p{L}][\p{L}\s''-]*$/u)
  firstName?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeName(value))
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[\p{L}][\p{L}\s''-]*$/u)
  lastName?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsString()
  @MinLength(10, { message: "Le motif doit contenir au moins 10 caractères" })
  @MaxLength(300, { message: "Le motif ne peut pas dépasser 300 caractères" })
  reason: string;
}

export class PhoneChangeRequestDto {
  @IsString()
  newPhone: string;
}

export class PhoneChangeConfirmDto {
  @IsString()
  @Matches(/^\d{4,6}$/)
  code: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private npiCrypto: NpiCryptoService,
    private notifications: NotificationsService,
  ) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        fullName: true,
        role: true,
        status: true,
        language: true,
        createdAt: true,
        firstName: true,
        lastName: true,
        gender: true,
        npiHash: true,
        npiCipher: true,
        npiLast4: true,
        profileCompletedAt: true,
        email: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        identityCorrectedAt: true,
      },
    });
    if (!user) return null;

    const base = toUserProfile(user);

    // identityEditableUntil : profileCompletedAt + 24h si identityCorrectedAt est null
    let identityEditableUntil: string | null = null;
    if (user.profileCompletedAt && !user.identityCorrectedAt) {
      identityEditableUntil = new Date(user.profileCompletedAt.getTime() + IDENTITY_CORRECTION_WINDOW_MS).toISOString();
    }

    // identityCorrectionPending : true si une demande PENDING existe
    const pendingCorrection = await this.prisma.identityCorrectionRequest.findFirst({
      where: { userId, status: "PENDING" },
      select: { id: true },
    });

    return {
      ...base,
      email: user.email ?? null,
      emergencyContact:
        user.emergencyContactName && user.emergencyContactPhone
          ? { name: user.emergencyContactName, phone: user.emergencyContactPhone }
          : null,
      identityEditableUntil,
      identityCorrectionPending: !!pendingCorrection,
    };
  }

  async register(userId: string, dto: RegisterUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        profileCompletedAt: true,
        firstName: true,
        lastName: true,
        gender: true,
        npiHash: true,
        npiCipher: true,
        npiLast4: true,
      },
    });
    if (!user) throw new NotFoundException("Compte introuvable");
    if (user.profileCompletedAt || isRegistrationComplete(user)) {
      throw new ConflictException("Ton inscription est déjà terminée.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT TRUE AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${userId}))) AS lock_result`;
      const attempts = await tx.npiRegistrationAttempt.count({
        where: { userId, createdAt: { gt: new Date(Date.now() - REGISTRATION_ATTEMPT_WINDOW_MS) } },
      });
      if (attempts >= MAX_REGISTRATION_ATTEMPTS) {
        throw new HttpException(
          "Trop de tentatives d'inscription. Réessaie dans une heure.",
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      await tx.npiRegistrationAttempt.create({ data: { userId } });
    });

    const npiHash = this.npiCrypto.hash(dto.npi);
    const profileCompletedAt = new Date();
    try {
      const result = await this.prisma.user.updateMany({
        where: { id: userId, profileCompletedAt: null },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          gender: dto.gender,
          fullName: `${dto.firstName} ${dto.lastName}`,
          npiHash,
          npiCipher: this.npiCrypto.encrypt(dto.npi),
          npiLast4: dto.npi.slice(-4),
          profileCompletedAt,
          signupKind: dto.accountKind ?? "CLIENT",
        },
      });
      if (result.count !== 1) {
        throw new ConflictException("Ton inscription est déjà terminée.");
      }
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("Ce NPI est déjà utilisé. Contacte le support.");
      }
      throw error;
    }

    return this.me(userId);
  }

  async updateLegacyProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        profileCompletedAt: true,
        firstName: true,
        lastName: true,
        gender: true,
        npiHash: true,
        npiCipher: true,
        npiLast4: true,
      },
    });
    if (!user) throw new NotFoundException("Compte introuvable");
    if (user.profileCompletedAt || isRegistrationComplete(user)) {
      throw new ConflictException("Ton profil inscrit ne peut plus être modifié.");
    }
    await this.prisma.user.update({ where: { id: userId }, data: { fullName: dto.fullName } });
    return this.me(userId);
  }

  /**
   * Photo de profil du compte. À défaut de photo enregistrée, la photo de profil déposée dans le dossier prestataire (pièce
   * « photo de profil », obligatoire pour un Speeder) sert de photo : un prestataire la retrouve donc même s'il ne l'a jamais
   * choisie dans l'application.
   */
  async getAvatar(userId: string) {
    const saved = await this.prisma.userAvatar.findUnique({ where: { userId }, select: { dataUri: true, updatedAt: true } });
    if (saved) return { dataUri: saved.dataUri, source: "USER" as const, updatedAt: saved.updatedAt };
    const doc = await this.prisma.providerDocument.findFirst({
      where: { kind: "PROFILE_PHOTO", provider: { userId }, url: { startsWith: "data:image" } },
      orderBy: { uploadedAt: "desc" },
      select: { url: true, uploadedAt: true },
    });
    if (doc?.url) return { dataUri: doc.url, source: "DOSSIER" as const, updatedAt: doc.uploadedAt };
    return { dataUri: null, source: null, updatedAt: null };
  }

  async setAvatar(userId: string, dataUri: string) {
    await this.prisma.userAvatar.upsert({ where: { userId }, create: { userId, dataUri }, update: { dataUri } });
    return { saved: true };
  }

  /** Retire la photo choisie ; la pièce du dossier prestataire n'est pas touchée (elle reste un document de vérification). */
  async removeAvatar(userId: string) {
    await this.prisma.userAvatar.deleteMany({ where: { userId } });
    return { removed: true };
  }

  async updateLanguage(userId: string, dto: UpdateLanguageDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException("Compte introuvable");
    await this.prisma.user.update({ where: { id: userId }, data: { language: dto.language } });
    return this.me(userId);
  }

  // ─── 1.2.3 PATCH /users/me/profile ─────────────────────────────────────────

  async updateMyProfile(userId: string, dto: UpdateMyProfileDto) {
    // Limite de débit : 10 appels/heure
    const recentCount = await this.prisma.userProfileChange.count({
      where: { userId, at: { gt: new Date(Date.now() - PROFILE_RATE_WINDOW_MS) } },
    });
    if (recentCount >= PROFILE_RATE_LIMIT * 5) {
      // 5 champs max par appel × 10 appels = 50 entrées max
      throw new HttpException(
        { code: "TOO_MANY_REQUESTS", message: "Trop de modifications. Réessaie dans une heure." },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emergencyContactName: true, emergencyContactPhone: true, phone: true },
    });
    if (!current) throw new NotFoundException("Compte introuvable");

    const updates: Record<string, unknown> = {};
    const auditEntries: { field: string; oldValue: string | null; newValue: string | null }[] = [];

    // Email
    if ("email" in dto) {
      const newEmail = dto.email === null ? null : (dto.email?.toLowerCase().trim() ?? null);
      if (newEmail !== undefined && newEmail !== current.email) {
        updates.email = newEmail;
        auditEntries.push({ field: "email", oldValue: current.email ?? null, newValue: newEmail });
      }
    }

    // Contact d'urgence
    if ("emergencyContact" in dto) {
      if (dto.emergencyContact === null) {
        if (current.emergencyContactName || current.emergencyContactPhone) {
          updates.emergencyContactName = null;
          updates.emergencyContactPhone = null;
          auditEntries.push({ field: "emergencyContact", oldValue: current.emergencyContactName ?? null, newValue: null });
        }
      } else if (dto.emergencyContact) {
        const ec = dto.emergencyContact;
        if (!isValidBeninPhone(ec.phone)) {
          throw new BadRequestException({
            code: "EMERGENCY_CONTACT_INVALID",
            message: "Le numéro du contact d'urgence doit être un numéro béninois à 10 chiffres commençant par 01.",
          });
        }
        const normalizedEmergencyPhone = normalizeBeninPhone(ec.phone);
        if (normalizedEmergencyPhone === current.phone) {
          throw new BadRequestException({
            code: "EMERGENCY_PHONE_SAME_AS_OWN",
            message: "Le numéro du contact d'urgence ne peut pas être le même que votre numéro de compte.",
          });
        }
        const newName = normalizeName(ec.name) as string;
        if (newName !== current.emergencyContactName || normalizedEmergencyPhone !== current.emergencyContactPhone) {
          updates.emergencyContactName = newName;
          updates.emergencyContactPhone = normalizedEmergencyPhone;
          auditEntries.push({ field: "emergencyContact", oldValue: current.emergencyContactName ?? null, newValue: newName });
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.prisma.user.update({ where: { id: userId }, data: updates });
      if (auditEntries.length > 0) {
        await this.prisma.userProfileChange.createMany({
          data: auditEntries.map((e) => ({ userId, field: e.field, oldValue: e.oldValue, newValue: e.newValue })),
        });
      }
    }

    return this.me(userId);
  }

  // ─── 1.2.4 PATCH /users/me/identity ─────────────────────────────────────────

  async updateIdentity(userId: string, dto: UpdateIdentityDto) {
    if (!dto.firstName && !dto.lastName && !dto.gender) {
      throw new BadRequestException("Au moins un champ doit être fourni.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        profileCompletedAt: true,
        identityCorrectedAt: true,
        firstName: true,
        lastName: true,
        gender: true,
        npiHash: true,
        npiCipher: true,
        npiLast4: true,
      },
    });
    if (!user) throw new NotFoundException("Compte introuvable");

    if (!user.profileCompletedAt || !isRegistrationComplete(user)) {
      throw new ConflictException({
        code: "REGISTRATION_REQUIRED",
        message: "Termine ton inscription pour pouvoir corriger tes informations.",
      });
    }

    if (user.identityCorrectedAt) {
      throw new ConflictException({
        code: "IDENTITY_ALREADY_CORRECTED",
        message: "Tu as déjà utilisé ta correction d'identité directe.",
      });
    }

    const windowEnd = new Date(user.profileCompletedAt.getTime() + IDENTITY_CORRECTION_WINDOW_MS);
    if (new Date() > windowEnd) {
      throw new ForbiddenException({
        code: "IDENTITY_WINDOW_CLOSED",
        message: "La fenêtre de correction directe (24 h après l'inscription) est fermée. Soumets une demande de correction.",
      });
    }

    const now = new Date();
    const newFirstName = dto.firstName ?? user.firstName ?? "";
    const newLastName = dto.lastName ?? user.lastName ?? "";

    // Atomique : updateMany avec identityCorrectedAt: null dans le WHERE
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, identityCorrectedAt: null },
      data: {
        ...(dto.firstName ? { firstName: dto.firstName } : {}),
        ...(dto.lastName ? { lastName: dto.lastName } : {}),
        ...(dto.gender ? { gender: dto.gender } : {}),
        fullName: `${newFirstName} ${newLastName}`.trim(),
        identityCorrectedAt: now,
      },
    });

    if (count === 0) {
      throw new ConflictException({
        code: "IDENTITY_ALREADY_CORRECTED",
        message: "Tu as déjà utilisé ta correction d'identité directe.",
      });
    }

    // Journal d'audit
    const entries: { field: string; oldValue: string | null; newValue: string | null }[] = [];
    if (dto.firstName && dto.firstName !== user.firstName) {
      entries.push({ field: "firstName", oldValue: user.firstName ?? null, newValue: dto.firstName });
    }
    if (dto.lastName && dto.lastName !== user.lastName) {
      entries.push({ field: "lastName", oldValue: user.lastName ?? null, newValue: dto.lastName });
    }
    if (dto.gender && dto.gender !== user.gender) {
      entries.push({ field: "gender", oldValue: user.gender ?? null, newValue: dto.gender });
    }
    if (entries.length > 0) {
      await this.prisma.userProfileChange.createMany({
        data: entries.map((e) => ({ userId, field: e.field, oldValue: e.oldValue, newValue: e.newValue })),
      });
    }

    return this.me(userId);
  }

  // ─── 1.2.5 POST /users/me/identity-correction-requests ──────────────────────

  async createIdentityCorrectionRequest(userId: string, dto: CreateIdentityCorrectionRequestDto) {
    if (!dto.firstName && !dto.lastName && !dto.gender) {
      throw new BadRequestException("Au moins un champ à corriger doit être fourni.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profileCompletedAt: true, firstName: true, lastName: true, gender: true },
    });
    if (!user || !user.profileCompletedAt) {
      throw new ConflictException({
        code: "REGISTRATION_REQUIRED",
        message: "Termine ton inscription pour soumettre une demande de correction.",
      });
    }

    const existing = await this.prisma.identityCorrectionRequest.findFirst({
      where: { userId, status: "PENDING" },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: "IDENTITY_REQUEST_PENDING",
        message: "Tu as déjà une demande de correction en attente.",
      });
    }

    const request = await this.prisma.identityCorrectionRequest.create({
      data: {
        userId,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        gender: dto.gender ?? null,
        reason: dto.reason,
        status: "PENDING",
      },
    });

    return { id: request.id, status: request.status };
  }

  // ─── 1.2.6 Changement de téléphone ──────────────────────────────────────────

  async requestPhoneChange(userId: string, dto: PhoneChangeRequestDto) {
    // Valider le nouveau numéro
    if (!isValidBeninPhone(dto.newPhone)) {
      throw new BadRequestException({
        code: "PHONE_INVALID",
        message: "Numéro béninois invalide : saisir 10 chiffres commençant par 01 (ex. 01 XX XX XX XX).",
      });
    }
    const newPhone = normalizeBeninPhone(dto.newPhone);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        phone: true,
        provider: { select: { status: true } },
      },
    });
    if (!user) throw new NotFoundException("Compte introuvable");

    if (newPhone === user.phone) {
      throw new BadRequestException({
        code: "PHONE_INVALID",
        message: "Ce numéro est déjà ton numéro actuel.",
      });
    }

    // Prestataire en cours d'examen : refus
    const blockedStatuses = ["SUBMITTED", "UNDER_REVIEW"];
    if (user.provider && blockedStatuses.includes(user.provider.status)) {
      throw new ForbiddenException({
        code: "PHONE_CHANGE_FORBIDDEN",
        message: "Le changement de numéro est interdit pendant l'examen de ton dossier.",
      });
    }

    // Numéro déjà utilisé par un autre compte
    const collision = await this.prisma.user.findFirst({
      where: { phone: newPhone, NOT: { id: userId } },
      select: { id: true },
    });
    if (collision) {
      throw new ConflictException({
        code: "PHONE_ALREADY_USED",
        message: "Ce numéro est déjà associé à un compte.",
      });
    }

    // Limite de débit : 3 demandes/heure
    const recentCount = await this.prisma.phoneChangeRequest.count({
      where: { userId, createdAt: { gt: new Date(Date.now() - PHONE_CHANGE_RATE_WINDOW_MS) } },
    });
    if (recentCount >= PHONE_CHANGE_RATE_LIMIT) {
      throw new HttpException(
        { code: "OTP_TOO_MANY_REQUESTS", message: "Trop de demandes de code. Réessaie dans une heure." },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // Générer un code à 6 chiffres et le hasher
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = this.npiCrypto.hash(code); // réutilisation du service de hash
    const expiresAt = new Date(Date.now() + PHONE_CHANGE_TTL_MS);

    await this.prisma.phoneChangeRequest.create({
      data: { userId, newPhone, codeHash, expiresAt },
    });

    // En mode dev : log du code (comme pour l'OTP de connexion)
    console.log(`[PHONE_CHANGE DEV] ${newPhone} -> ${code}`);

    const maskedPhone = this.maskPhone(newPhone);
    return { expiresInSeconds: Math.floor(PHONE_CHANGE_TTL_MS / 1000), maskedPhone };
  }

  async confirmPhoneChange(userId: string, dto: PhoneChangeConfirmDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user) throw new NotFoundException("Compte introuvable");

    // Dernière demande non utilisée et non expirée
    const request = await this.prisma.phoneChangeRequest.findFirst({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!request) {
      throw new BadRequestException({
        code: "OTP_INVALID_OR_EXPIRED",
        message: "Code invalide ou expiré. Lance une nouvelle demande de changement.",
      });
    }

    // Vérifier le code
    const codeHash = this.npiCrypto.hash(dto.code);
    if (codeHash !== request.codeHash) {
      // Incrémenter les tentatives
      await this.prisma.phoneChangeRequest.update({
        where: { id: request.id },
        data: { attempts: { increment: 1 } },
      });
      const updated = await this.prisma.phoneChangeRequest.findUnique({
        where: { id: request.id },
        select: { attempts: true },
      });
      if ((updated?.attempts ?? 0) >= PHONE_CHANGE_MAX_ATTEMPTS) {
        // Invalider la demande
        await this.prisma.phoneChangeRequest.update({
          where: { id: request.id },
          data: { usedAt: new Date() },
        });
        throw new BadRequestException({
          code: "OTP_TOO_MANY_ATTEMPTS",
          message: "Trop de tentatives erronées. Lance une nouvelle demande de changement.",
        });
      }
      throw new BadRequestException({
        code: "OTP_WRONG_CODE",
        message: "Code incorrect.",
      });
    }

    const oldPhone = user.phone;
    const newPhone = request.newPhone;
    const now = new Date();

    // Mise à jour atomique avec vérification d'unicité
    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { phone: newPhone },
        }),
        this.prisma.phoneChangeRequest.update({
          where: { id: request.id },
          data: { usedAt: now },
        }),
        this.prisma.userProfileChange.create({
          data: {
            userId,
            field: "phone",
            oldValue: oldPhone.slice(-4),
            newValue: newPhone.slice(-4),
            at: now,
          },
        }),
      ]);
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new ConflictException({
          code: "PHONE_ALREADY_USED",
          message: "Ce numéro est déjà associé à un compte.",
        });
      }
      throw error;
    }

    // Notification à l'ancien canal
    await this.notifications
      .push(
        userId,
        "Numéro modifié",
        `Ton numéro de compte a été changé. Si tu n'es pas à l'origine de ce changement, contacte le support immédiatement.`,
        "security",
        {
          titleKey: "NOTIFICATION_PHONE_CHANGED",
          sendPush: true,
        }
      )
      .catch(() => null);

    return this.me(userId);
  }

  // ─── Admin : corrections d'identité ─────────────────────────────────────────

  async listPendingIdentityCorrections() {
    return this.prisma.identityCorrectionRequest.findMany({
      where: { status: "PENDING" },
      include: { user: { select: { firstName: true, lastName: true, gender: true, phone: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async approveIdentityCorrection(requestId: string, adminId: string) {
    const request = await this.prisma.identityCorrectionRequest.findUnique({
      where: { id: requestId },
      include: { user: { select: { id: true, firstName: true, lastName: true, gender: true } } },
    });
    if (!request) throw new NotFoundException("Demande introuvable");
    if (request.status !== "PENDING") throw new ConflictException("Cette demande n'est plus en attente.");

    const now = new Date();
    const newFirstName = request.firstName ?? request.user.firstName ?? "";
    const newLastName = request.lastName ?? request.user.lastName ?? "";

    await this.prisma.$transaction([
      this.prisma.identityCorrectionRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED", decidedById: adminId, decidedAt: now },
      }),
      this.prisma.user.update({
        where: { id: request.userId },
        data: {
          ...(request.firstName ? { firstName: request.firstName } : {}),
          ...(request.lastName ? { lastName: request.lastName } : {}),
          ...(request.gender ? { gender: request.gender } : {}),
          fullName: `${newFirstName} ${newLastName}`.trim(),
          identityCorrectedAt: now,
        },
      }),
    ]);

    await this.notifications
      .push(
        request.userId,
        "Correction d'identité approuvée",
        "Tes informations personnelles ont été mises à jour.",
        "account",
        { titleKey: "NOTIFICATION_IDENTITY_APPROVED", sendPush: true }
      )
      .catch(() => null);

    return { approved: true };
  }

  async rejectIdentityCorrection(requestId: string, adminId: string, rejectReason: string) {
    const request = await this.prisma.identityCorrectionRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException("Demande introuvable");
    if (request.status !== "PENDING") throw new ConflictException("Cette demande n'est plus en attente.");

    await this.prisma.identityCorrectionRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", decidedById: adminId, decidedAt: new Date(), rejectReason },
    });

    await this.notifications
      .push(
        request.userId,
        "Correction d'identité refusée",
        `Ta demande de correction a été refusée : ${rejectReason}`,
        "account",
        { titleKey: "NOTIFICATION_IDENTITY_REJECTED", sendPush: true, params: { reason: rejectReason } }
      )
      .catch(() => null);

    return { rejected: true };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private maskPhone(phone: string): string {
    // +22901XXXXXXXX -> "01•••••XX"
    const local = extractLocalBeninDigits(phone);
    if (local.length < 4) return "•••••";
    return `${local.slice(0, 2)}${"•".repeat(local.length - 4)}${local.slice(-2)}`;
  }
}

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get("me")
  me(@CurrentUser() user) {
    return this.users.me(user.userId);
  }

  @Post("me/registration")
  @Roles(Role.CLIENT)
  register(@CurrentUser() user, @Body() dto: RegisterUserDto) {
    return this.users.register(user.userId, dto);
  }

  @Patch("me")
  @Roles(Role.CLIENT)
  updateLegacyProfile(@CurrentUser() user, @Body() dto: UpdateProfileDto) {
    return this.users.updateLegacyProfile(user.userId, dto);
  }

  @Get("me/avatar")
  getAvatar(@CurrentUser() user) {
    return this.users.getAvatar(user.userId);
  }

  @Put("me/avatar")
  setAvatar(@CurrentUser() user, @Body() dto: UpdateAvatarDto) {
    return this.users.setAvatar(user.userId, dto.dataUri);
  }

  @Delete("me/avatar")
  removeAvatar(@CurrentUser() user) {
    return this.users.removeAvatar(user.userId);
  }

  @Patch("me/language")
  updateLanguage(@CurrentUser() user, @Body() dto: UpdateLanguageDto) {
    return this.users.updateLanguage(user.userId, dto);
  }

  /** 1.2.3 — Modifier email et/ou contact d'urgence */
  @Patch("me/profile")
  updateMyProfile(@CurrentUser() user, @Body() dto: UpdateMyProfileDto) {
    return this.users.updateMyProfile(user.userId, dto);
  }

  /** 1.2.4 — Correction d'identité directe (CLIENT, fenêtre 24 h) */
  @Patch("me/identity")
  @Roles(Role.CLIENT)
  updateIdentity(@CurrentUser() user, @Body() dto: UpdateIdentityDto) {
    return this.users.updateIdentity(user.userId, dto);
  }

  /** 1.2.5 — Demande de correction après la fenêtre */
  @Post("me/identity-correction-requests")
  @Roles(Role.CLIENT)
  createIdentityCorrectionRequest(@CurrentUser() user, @Body() dto: CreateIdentityCorrectionRequestDto) {
    return this.users.createIdentityCorrectionRequest(user.userId, dto);
  }

  /** 1.2.6 — Changement de numéro : demande */
  @Post("me/phone-change/request")
  @HttpCode(202)
  requestPhoneChange(@CurrentUser() user, @Body() dto: PhoneChangeRequestDto) {
    return this.users.requestPhoneChange(user.userId, dto);
  }

  /** 1.2.6 — Changement de numéro : confirmation */
  @Post("me/phone-change/confirm")
  confirmPhoneChange(@CurrentUser() user, @Body() dto: PhoneChangeConfirmDto) {
    return this.users.confirmPhoneChange(user.userId, dto);
  }
}

@Controller("admin/identity-corrections")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminIdentityCorrectionsController {
  constructor(private users: UsersService) {}

  @Get()
  list() {
    return this.users.listPendingIdentityCorrections();
  }

  @Post(":id/approve")
  approve(@Param("id") id: string, @CurrentUser() admin) {
    return this.users.approveIdentityCorrection(id, admin.userId);
  }

  @Post(":id/reject")
  reject(@Param("id") id: string, @CurrentUser() admin, @Body() body: { reason: string }) {
    return this.users.rejectIdentityCorrection(id, admin.userId, body.reason ?? "");
  }
}

// Ajout de l'import de Param manquant dans le contrôleur admin — déjà importé en haut du fichier

@Module({
  imports: [NotificationsModule],
  controllers: [UsersController, AdminIdentityCorrectionsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
