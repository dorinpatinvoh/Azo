import { Body, Controller, Get, Injectable, Module, Patch, UseGuards } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

class UpdateProfileDto {
  @IsOptional() @IsString() fullName?: string;
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

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({ where: { id: userId }, data: dto });
  }
}

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  // GET /users/me
  @Get("me")
  me(@CurrentUser() user) {
    return this.users.me(user.userId);
  }

  // PATCH /users/me  { "fullName": "Amine" }
  @Patch("me")
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
