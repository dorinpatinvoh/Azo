import { Body, Controller, Get, Injectable, Module, Post, Query, UseGuards } from "@nestjs/common";
import { IsString } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

class RequestDto {
  @IsString() category: string;
}

@Injectable()
export class ArtisansService {
  constructor(private prisma: PrismaService) {}
  // Les artisans sont des utilisateurs avec le rôle ARTISAN
  list() {
    return this.prisma.user.findMany({
      where: { role: "ARTISAN" },
      select: { id: true, fullName: true, phone: true },
    });
  }
  request(clientId: string, dto: RequestDto) {
    return this.prisma.artisanRequest.create({ data: { clientId, category: dto.category } });
  }
}

@Controller("artisans")
@UseGuards(JwtAuthGuard)
export class ArtisansController {
  constructor(private svc: ArtisansService) {}
  @Get() list(@Query("category") _category?: string) { return this.svc.list(); }
  @Post("requests") request(@CurrentUser() u, @Body() dto: RequestDto) { return this.svc.request(u.userId, dto); }
}

@Module({ controllers: [ArtisansController], providers: [ArtisansService] })
export class ArtisansModule {}
