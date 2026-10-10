import { Body, Controller, Get, Injectable, Module, Patch, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";

// Nom ou pseudo du client : obligatoire, espaces superflus retirés avant validation
// (« "   " » est donc refusé comme une chaîne vide).
export class UpdateProfileDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value))
  @IsString({ message: "Le nom ou pseudo doit être un texte" })
  @IsNotEmpty({ message: "Le nom ou pseudo ne peut pas être vide" })
  @MinLength(2, { message: "Le nom ou pseudo doit contenir au moins 2 caractères" })
  @MaxLength(50, { message: "Le nom ou pseudo ne peut pas dépasser 50 caractères" })
  fullName: string;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, fullName: true, role: true, createdAt: true },
    });
  }

  // Seul `fullName` est écrit (jamais le DTO entier) : aucun autre champ du compte
  // (rôle, statut, téléphone) ne peut être modifié par cette route.
  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fullName: dto.fullName },
      select: { id: true, phone: true, fullName: true, role: true, createdAt: true },
    });
  }
}

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  // GET /users/me
  @Get("me")
  me(@CurrentUser() user) {
    return this.users.me(user.userId);
  }

  // PATCH /users/me  { "fullName": "Amine" } — réservé au client authentifié
  @Patch("me")
  @Roles(Role.CLIENT)
  update(@CurrentUser() user, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.userId, dto);
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
