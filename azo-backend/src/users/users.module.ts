import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Gender, Role } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { NpiCryptoService } from "../common/npi-crypto.service";
import { isRegistrationComplete, toUserProfile } from "../common/registration-profile";

export const MAX_REGISTRATION_ATTEMPTS = 3;
export const REGISTRATION_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
}

function normalizeNpi(value: unknown) {
  return typeof value === "string" ? value.replace(/[\s.-]/g, "") : value;
}

export class RegisterUserDto {
  @Transform(({ value }) => normalizeName(value))
  @IsString({ message: "Le prénom doit être un texte" })
  @MinLength(2, { message: "Le prénom doit contenir au moins 2 caractères" })
  @MaxLength(50, { message: "Le prénom ne peut pas dépasser 50 caractères" })
  @Matches(/^[\p{L}][\p{L}\s'’-]*$/u, {
    message: "Le prénom ne peut contenir que des lettres, espaces, tirets et apostrophes",
  })
  firstName: string;

  @Transform(({ value }) => normalizeName(value))
  @IsString({ message: "Le nom doit être un texte" })
  @MinLength(2, { message: "Le nom doit contenir au moins 2 caractères" })
  @MaxLength(50, { message: "Le nom ne peut pas dépasser 50 caractères" })
  @Matches(/^[\p{L}][\p{L}\s'’-]*$/u, {
    message: "Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes",
  })
  lastName: string;

  @IsEnum(Gender, { message: "Le sexe doit être M ou F" })
  gender: Gender;

  @Transform(({ value }) => normalizeNpi(value))
  @IsString({ message: "Le NPI doit être un texte de 10 chiffres" })
  @Matches(/^\d{10}$/, { message: "Le NPI doit contenir exactement 10 chiffres" })
  npi: string;
}

export class UpdateProfileDto {
  @Transform(({ value }) => normalizeName(value))
  @IsString({ message: "Le nom ou pseudo doit être un texte" })
  @IsNotEmpty({ message: "Le nom ou pseudo ne peut pas être vide" })
  @MinLength(2, { message: "Le nom ou pseudo doit contenir au moins 2 caractères" })
  @MaxLength(50, { message: "Le nom ou pseudo ne peut pas dépasser 50 caractères" })
  fullName: string;
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private npiCrypto: NpiCryptoService
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
        createdAt: true,
        firstName: true,
        lastName: true,
        gender: true,
        npiHash: true,
        npiCipher: true,
        npiLast4: true,
      },
    });
    return user ? toUserProfile(user) : null;
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
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
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
}

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
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
